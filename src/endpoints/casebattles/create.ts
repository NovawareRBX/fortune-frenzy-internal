import { FastifyRequest } from "fastify";
import { getRedisConnection } from "../../service/redis";
import { CaseBattleData, CasebattlesRedisManager } from "../../service/casebattles-redis";
import { randomBytes, randomUUID } from "crypto";
import getUserInfo from "../../utilities/getUserInfo";
import { getMariaConnection } from "../../service/mariadb";

async function getCasesFromIDs(cbrm: CasebattlesRedisManager, ids: string[]) {
	const cachedCases = await cbrm.getCases();
	const caseMap = new Map(cachedCases.map((c) => [c.id, c]));

	return ids
		.filter((id) => caseMap.has(id))
		.map((id) => {
			const c = caseMap.get(id)!;
			return {
				id: c.id,
				name: c.name,
				image: c.image,
				items: c.items.map((i) => ({
					id: i.id,
					asset_id: i.asset_id,
					min_ticket: i.min_ticket,
					max_ticket: i.max_ticket,
					value: i.value,
				})),
			};
		});
}

export default {
	method: "POST",
	url: "/casebattles/create",
	authType: "key",
	callback: async function (
		request: FastifyRequest<{
			Body: {
				user_id: number;
				client_seed: string;
				cases: Array<string>;
				mode: "standard" | "randomized" | "showdown" | "group";
				team_mode: "1v1" | "1v1v1" | "1v1v1v1" | "2v2";
				fast_mode: boolean;
				crazy: boolean;
				server_id: string;
			};
		}>,
	): Promise<[number, any]> {
		const body = request.body;
		if (
			!(
				typeof body === "object" &&
				typeof body.user_id === "number" &&
				Array.isArray(body.cases) &&
				body.cases.every((item: any) => typeof item === "string") &&
				["standard", "randomized", "showdown", "group"].includes(body.mode) &&
				["1v1", "1v1v1", "1v1v1v1", "2v2"].includes(body.team_mode) &&
				typeof body.fast_mode === "boolean" &&
				typeof body.crazy === "boolean" &&
				typeof body.server_id === "string"
			)
		) {
			return [400, { message: "Invalid request" }];
		}

		const redis = await getRedisConnection();
		if (!redis) return [500, { message: "Failed to connect to Redis" }];
		const connection = await getMariaConnection();
		if (!connection) return [500, { message: "Failed to connect to MariaDB" }];

		const casebattlesRedisManager = new CasebattlesRedisManager(redis, request.server);
		const casebattleId = randomUUID();
		const cases = await getCasesFromIDs(casebattlesRedisManager, body.cases);
		const userInfo = await getUserInfo(connection, [body.user_id.toString()]);

		if (!userInfo || userInfo.length === 0) {
			return [400, { message: "Invalid user ID" }];
		}

		if (cases.length === 0 || cases.length !== body.cases.length) {
			return [400, { message: "Invalid case IDs" }];
		}

		const casebattle: CaseBattleData = {
			id: casebattleId,
			server_id: body.server_id,
			server_seed: randomBytes(16).toString("hex"),
			team_mode: body.team_mode,
			crazy: body.crazy,
			mode: body.mode,
			fast_mode: body.fast_mode,
			players: [
				{
					id: userInfo[0].id.toString(),
					username: userInfo[0].username,
					display_name: userInfo[0].display_name,
					position: 1,
					bot: false,
					client_seed: body.client_seed,
				},
			],
			cases: body.cases,
			player_pulls: {
				[userInfo[0].id.toString()]: {
					items: [],
					total_value: 0,
				},
			},
			current_spin_data: {
				current_case_index: -1,
			},
			status: "waiting_for_players",
			created_at: Date.now(),
			started_at: -1,
			completed_at: -1,
			updated_at: Date.now(),
		};

		const success = await casebattlesRedisManager.createCaseBattle(casebattle);
		if (!success) {
			const playerKey = `casebattle:player:${userInfo[0].id}`;
			const existingBattleId = await redis.get(playerKey);
			if (existingBattleId) {
				const existingBattle = await casebattlesRedisManager.getCaseBattle(existingBattleId);
				if (existingBattle && existingBattle.status !== "completed") {
					return [409, { message: "You already have an active case battle" }];
				}
			}
			return [500, { message: "Failed to create case battle due to system error" }];
		}

		connection.release();
		return [200, { status: "OK", data: casebattle }];
	},
};