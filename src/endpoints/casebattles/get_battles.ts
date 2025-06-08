import { FastifyRequest } from "fastify";
import { getRedisConnection } from "../../service/redis";
import { CasebattlesRedisManager } from "../../service/casebattles-redis";

export default {
	method: "GET",
	url: "/casebattles",
	authType: "none",
	callback: async function (
		request: FastifyRequest<{
			Querystring: { server_id?: string };
		}>,
	): Promise<[number, any]> {
		try {
			const redis = await getRedisConnection();
			if (!redis) {
				return [500, { error: "Failed to connect to Redis" }];
			}

			const { server_id } = request.query;
			const casebattlesManager = new CasebattlesRedisManager(redis, request.server);

			const casebattleIds = await casebattlesManager.getActiveCaseBattles(server_id);
			if (!casebattleIds || casebattleIds.length === 0) {
				return [200, { status: "OK", casebattles: [] }];
			}

			const casebattles = await Promise.all(casebattleIds.map((id) => casebattlesManager.getCaseBattle(id)));
			const filteredCasebattles = casebattles.filter((cb) => cb !== null);

			return [200, { status: "OK", casebattles: filteredCasebattles }];
		} catch (error) {
			return [500, { error: "Failed to get casebattles" }];
		}
	},
};
