import { FastifyRequest } from "fastify";
import { getRedisConnection } from "../../service/redis";
import { CasebattlesRedisManager } from "../../service/casebattles-redis";
import getUserInfo from "../../utilities/getUserInfo";
import { getMariaConnection } from "../../service/mariadb";

export default {
	method: "POST",
	url: "/casebattles/start/:id",
	authType: "key",
	callback: async function (
		request: FastifyRequest<{
			Params: { id: string };
		}>,
	): Promise<[number, any]> {
		const { id } = request.params;
		const redis = await getRedisConnection();
		if (!redis) return [500, { message: "Failed to connect to Redis" }];
		const connection = await getMariaConnection();
		if (!connection) return [500, { message: "Failed to connect to MariaDB" }];

		const casebattlesRedisManager = new CasebattlesRedisManager(redis, request.server);
		const casebattle = await casebattlesRedisManager.getCaseBattle(id);
		if (!casebattle) return [404, { message: "Case battle not found" }];
		if (casebattle.status !== "waiting_for_players") return [400, { message: "Case battle already started" }];

		const userInfo = await getUserInfo(
			connection,
			casebattle.players.map((player) => player.id),
		);
		if (!userInfo) return [500, { message: "Failed to get user info" }];

		const maxPlayers =
			casebattle.team_mode === "2v2"
				? 4
				: casebattle.team_mode === "1v1v1v1"
				? 4
				: casebattle.team_mode === "1v1v1"
				? 3
				: 2;
		if (casebattle.players.length !== maxPlayers)
			return [400, { message: "Case battle does not have enough players" }];

		setImmediate(async () => {
			await casebattlesRedisManager.startCaseBattle(id);
		});

		connection.release();
		return [200, { message: "Case battle started" }];
	},
};
