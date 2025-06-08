import { FastifyRequest } from "fastify";
import { getRedisConnection } from "../../service/redis";
import { CaseBattleData, CasebattlesRedisManager } from "../../service/casebattles-redis";
import { randomBytes } from "crypto";
import getUserInfo from "../../utilities/getUserInfo";
import { getMariaConnection } from "../../service/mariadb";

const BOT_NAMES = [
	"CaseHunter",
	"LuckMaster",
	"SkinSeeker",
	"CaseKing",
	"BattleBot",
	"LootLord",
	"CaseWizard",
	"PrizePro",
];

export default {
	method: "POST",
	url: "/casebattles/join/:id",
	authType: "key",
	callback: async function (
		request: FastifyRequest<{
			Body: {
				user_id: number;
				position: number;
				client_seed: string;
			};
			Params: { id: string };
		}>,
	): Promise<[number, any]> {
		const { user_id, position, client_seed } = request.body;
		const { id: casebattleId } = request.params;

		if (
			!(
				typeof user_id === "number" &&
				typeof position === "number" &&
				typeof client_seed === "string" &&
				typeof casebattleId === "string"
			)
		) {
			return [400, { message: "Invalid request" }];
		}

		const redis = await getRedisConnection();
		if (!redis) return [500, { message: "Failed to connect to Redis" }];
		const connection = await getMariaConnection();
		if (!connection) return [500, { message: "Failed to connect to MariaDB" }];

		const casebattlesRedisManager = new CasebattlesRedisManager(redis, request.server);
		const casebattle = await casebattlesRedisManager.getCaseBattle(casebattleId);
		if (!casebattle) {
			return [404, { message: "Case battle not found" }];
		}

		if (casebattle.status !== "waiting_for_players") {
			return [400, { message: "Case battle is not accepting players" }];
		}

		const userInfo = await getUserInfo(connection, [user_id.toString()]);
		if (!userInfo || userInfo.length === 0) {
			return [400, { message: "Invalid user ID" }];
		}

		const isCreator = casebattle.players[0].id === user_id.toString();
		const isAlreadyJoined = casebattle.players.some((player) => player.id === user_id.toString());

		if (isAlreadyJoined && !isCreator) {
			return [400, { message: "User is already in the case battle" }];
		}

		const maxPlayers =
			casebattle.team_mode === "2v2"
				? 4
				: casebattle.team_mode === "1v1v1v1"
				? 4
				: casebattle.team_mode === "1v1v1"
				? 3
				: 2;
		if (
			position < 0 ||
			position > maxPlayers ||
			casebattle.players.some((player) => player.position === position)
		) {
			return [400, { message: "Invalid or taken position" }];
		}

		const newPlayer = isCreator
			? {
					id: `bot_${randomBytes(4).toString("hex")}`,
					username: BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)],
					display_name: BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)],
					position,
					bot: true,
					client_seed: randomBytes(16).toString("hex"),
			  }
			: {
					id: userInfo[0].id.toString(),
					username: userInfo[0].username,
					display_name: userInfo[0].display_name,
					position,
					bot: false,
					client_seed,
			  };

		const updatedCaseBattle: CaseBattleData = {
			...casebattle,
			players: [...casebattle.players, newPlayer],
			player_pulls: {
				...casebattle.player_pulls,
				[newPlayer.id]: {
					items: [],
					total_value: 0,
				},
			},
			updated_at: Date.now(),
		};

		const success = await casebattlesRedisManager.joinCaseBattle(casebattleId, updatedCaseBattle);
		if (!success) {
			return [409, { message: "Failed to join case battle, it may have started or been modified" }];
		}

		connection.release();
		return [200, { status: "OK", data: updatedCaseBattle }];
	},
};
