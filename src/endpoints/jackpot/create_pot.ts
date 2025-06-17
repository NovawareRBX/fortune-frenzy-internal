import { FastifyRequest } from "fastify";
import { getRedisConnection } from "../../service/redis";
import { JackpotRedisManager } from "../../service/jackpot-redis";
import { randomBytes } from "crypto";
import { generateServerSeed } from "../../utilities/secureRandomness";
import getUserInfo from "../../utilities/getUserInfo";
import { getMariaConnection } from "../../service/mariadb";
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
		const connection = await getMariaConnection();
		if (!redis) return [500, { error: "Failed to connect to the database" }];

		const [user_info] = await getUserInfo(connection, [creator.toString()]);
		const jackpotManager = new JackpotRedisManager(redis, request.server);
		const server_seed = generateServerSeed();
		const jackpot_id = randomBytes(20).toString("base64").replace(/[+/=]/g, "").substring(0, 20);
		const jackpot = await jackpotManager.createJackpot({
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

		if (!jackpot) return [500, { error: "Failed to create jackpot" }];

		return [200, { status: "OK", message: "Jackpot created successfully", jackpot_id }];
	},
};
