import { FastifyRequest } from "fastify";
import { getRedisConnection } from "../../service/redis";
import { CasebattlesRedisManager } from "../../service/casebattles-redis";
import { z } from "zod";

const battlesQuerySchema = z.object({
	server_id: z.string().optional(),
});

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

			const queryParse = battlesQuerySchema.safeParse(request.query);
			if (!queryParse.success) {
				return [400, { message: "Invalid request", errors: queryParse.error.flatten() }];
			}
			const { server_id } = queryParse.data;
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
