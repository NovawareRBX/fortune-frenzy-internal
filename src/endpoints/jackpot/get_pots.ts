import { FastifyRequest } from "fastify";
import { JackpotRedisManager } from "../../service/jackpot/jackpot-redis";
import { getRedisConnection } from "../../service/redis";

export default {
	method: "GET",
	url: "/jackpot/pots",
	authType: "none",
	callback: async (request: FastifyRequest) => {
		const redis = await getRedisConnection();
		if (!redis) return [500, { error: "Failed to connect to the database" }];

		const jackpotManager = new JackpotRedisManager(redis, request.server);
		const potIds = await jackpotManager.getActiveJackpots();

		const pots = await Promise.all(
			potIds.map(async (potId) => {
				const pot = await jackpotManager.getJackpot(potId);
				return pot;
			}),
		);

		return [200, { status: "OK", pots: pots.filter((pot) => pot !== null) }];
	},
};
