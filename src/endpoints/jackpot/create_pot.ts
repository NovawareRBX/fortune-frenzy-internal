import { FastifyRequest } from "fastify";
import { getRedisConnection } from "../../service/redis";
import { JackpotRedisManager } from "../../service/jackpot-redis";
import { randomBytes } from "crypto";
import { generateServerSeed } from "../../utilities/secureRandomness";
import getUserInfo from "../../utilities/getUserInfo";
import { getPostgresConnection } from "../../service/postgres";
import { z } from "zod";

const createPotSchema = z.object({
	creator: z.number(),
	server_id: z.string(),
	value_cap: z.number().positive(),
	starting_method: z.enum(["countdown", "manual"]),
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
				starting_method: "countdown" | "manual";
			};
		}>,
	) {
		const parseResult = createPotSchema.safeParse(request.body);
		if (!parseResult.success) {
			return [400, { error: "Invalid request", errors: parseResult.error.flatten() }];
		}
		const { creator, server_id, value_cap, starting_method } = parseResult.data;

		const redis = await getRedisConnection();
		if (!redis) return [500, { error: "Failed to connect to Redis" }];

		const connection = await getPostgresConnection();
		// Fallback response if something goes wrong before we can build a proper one
		let response: [number, Record<string, unknown>] = [500, { error: "Unknown error" }];
		try {
			const [user_info] = await getUserInfo(connection, [creator.toString()]);
			const jackpotManager = new JackpotRedisManager(redis, request.server);
			const server_seed = generateServerSeed();
			const jackpot_id = randomBytes(20)
				.toString("base64")
				.replace(/[+/=]/g, "")
				.substring(0, 20);

			const jackpotCreated = await jackpotManager.createJackpot({
				id: jackpot_id,
				server_id,
				server_seed,
				creator: user_info,
				value_cap,
				joinable: true,
				leaveable: true,
				starting_method,
				status: "waiting_for_start",
				members: [],
				starting_at: -1,
				created_at: Date.now(),
				updated_at: Date.now(),
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
			// Always release the Postgres connection if it was acquired
			connection?.release();
		}

		return response;
	},
};
