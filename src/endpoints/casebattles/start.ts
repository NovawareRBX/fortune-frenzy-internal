import { FastifyRequest } from "fastify";
import { getRedisConnection } from "../../service/redis";
import { CasebattlesRedisManager } from "../../service/casebattles-redis";
import getUserInfo from "../../utilities/getUserInfo";
import { getPostgresConnection } from "../../service/postgres";
import { z } from "zod";

const startParamsSchema = z.object({
	id: z.string(),
});

export default {
	method: "POST",
	url: "/casebattles/start/:id",
	authType: "key",
	callback: async function (
		request: FastifyRequest<{
			Params: { id: string };
		}>,
	): Promise<[number, any]> {
		const paramsParse = startParamsSchema.safeParse(request.params);
		if (!paramsParse.success) {
			return [400, { message: "Invalid request", errors: paramsParse.error.flatten() }];
		}
		const { id } = paramsParse.data;
		const redis = await getRedisConnection();
		if (!redis) return [500, { message: "Failed to connect to Redis" }];
		const connection = await getPostgresConnection();
		if (!connection) return [500, { message: "Failed to connect to database" }];

		const casebattlesRedisManager = new CasebattlesRedisManager(redis, request.server);
		const casebattle = await casebattlesRedisManager.getCaseBattle(id);
		if (!casebattle) return [404, { message: "Case battle not found" }];
		if (casebattle.status !== "waiting_for_players") return [400, { message: "Case battle already started" }];

		const userInfo = await getUserInfo(
			connection,
			casebattle.players.map((player) => player.id),
		);
		if (!userInfo) return [500, { message: "Failed to get user info" }];

		const maxPlayers = casebattle.team_mode
			.split("v")
			.map(Number)
			.reduce((sum, players) => sum + players, 0);
		if (casebattle.players.length !== maxPlayers)
			return [400, { message: "Case battle does not have enough players" }];

		setImmediate(async () => {
			await casebattlesRedisManager.startCaseBattle(id);
		});

		connection.release();
		return [200, { message: "Case battle started" }];
	},
};
