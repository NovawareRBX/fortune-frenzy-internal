import { FastifyRequest } from "fastify";
import { getRedisConnection } from "../../service/redis";
import { JackpotRedisManager } from "../../service/jackpot/jackpot-redis";
import { randomBytes } from "crypto";
import { generateServerSeed } from "../../utilities/secureRandomness";
import getUserInfo from "../../utilities/getUserInfo";
import { getPostgresConnection } from "../../service/postgres";
import { z } from "zod";

const createPotSchema = z.object({
	creator: z.number(),
	server_id: z.string(),
	value_cap: z.number().positive(),
	value_floor: z.number().positive().optional(),
	max_players: z.number().optional(),
	starting_after: z.number().min(5).max(300).optional(),
});

export default {
	method: "POST",
	url: "/jackpot/create",
	authType: "none",
	callback: async function (
		request: FastifyRequest<{
			Body: {
				creator: number;
				server_id: string;
				value_cap: number;
				value_floor?: number;
				max_players?: number;
				starting_after?: number;
			};
		}>,
	) {
		const parseResult = createPotSchema.safeParse(request.body);
		if (!parseResult.success) {
			return [400, { error: "Invalid request", errors: parseResult.error.flatten() }];
		}
		const { creator, server_id, value_cap, value_floor, max_players, starting_after } = parseResult.data;
		const redis = await getRedisConnection();
		if (!redis) return [500, { error: "Failed to connect to Redis" }];

		const creatorKey = `jackpot:creator:${creator}`;
		const existingJackpotId = await redis.get(creatorKey);
		if (existingJackpotId) {
			const jackpotManagerPrecheck = new JackpotRedisManager(redis, request.server);
			const existingJackpot = await jackpotManagerPrecheck.getJackpot(existingJackpotId);
			if (existingJackpot && existingJackpot.status !== "complete") {
				return [409, { error: "Creator already has an active jackpot", jackpot_id: existingJackpotId }];
			}
			await redis.del(creatorKey);
		}

		const connection = await getPostgresConnection();
		let response: [number, Record<string, unknown>] = [500, { error: "Unknown error" }];
		try {
			const [user_info] = await getUserInfo(connection, [creator.toString()]);
			const jackpotManager = new JackpotRedisManager(redis, request.server);
			const server_seed = generateServerSeed();
			const jackpot_id = randomBytes(20).toString("base64").replace(/[+/=]/g, "").substring(0, 20);

			const autoStartSec = starting_after ?? 120;
			const jackpotCreated = await jackpotManager.createJackpot({
				id: jackpot_id,
				server_id,
				server_seed,
				creator: user_info,
				value_cap,
				value_floor,
				max_players,
				joinable: true,
				leaveable: true,
				status: "waiting_for_start",
				members: [],
				starting_at: -1,
				created_at: Date.now(),
				updated_at: Date.now(),
				auto_start_ts: Math.floor(Date.now() / 1000) + autoStartSec,
			});

			if (!jackpotCreated) {
				response = [500, { error: "Failed to create jackpot" }];
			} else {
				response = [200, { status: "OK", message: "Jackpot created successfully", jackpot_id }];
			}
		} catch (err) {
			console.error("[create_pot] Unexpected error:", err);
			response = [500, { error: "Internal server error" }];
		} finally {
			connection.release();
		}

		return response;
	},
};
