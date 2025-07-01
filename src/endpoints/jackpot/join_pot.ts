import { FastifyRequest } from "fastify";
import { getRedisConnection } from "../../service/redis";
import { z } from "zod";
import { JackpotRedisManager } from "../../service/jackpot/jackpot-redis";
import { getPostgresConnection } from "../../service/postgres";
import getUserInfo from "../../utilities/getUserInfo";
import getItemString from "../../utilities/getItemString";
import getTotalValue from "../../utilities/getTotalValue";
import { randomBytes } from "crypto";

const joinPotSchema = z.object({
	user_id: z.number(),
	items: z.array(z.string().regex(/^FF/)).min(1),
	client_seed: z.string(),
});

const joinPotParamsSchema = z.object({
	id: z.string(),
});

export default {
	method: "POST",
	url: "/jackpot/join/:id",
	authType: "none",
	callback: async (
		request: FastifyRequest<{
			Params: { id: string };
			Body: {
				user_id: number;
				items: string[];
				client_seed: string;
			};
		}>,
	) => {
		const paramsParse = joinPotParamsSchema.safeParse(request.params);
		const bodyParse = joinPotSchema.safeParse(request.body);
		if (!paramsParse.success || !bodyParse.success) {
			return [
				400,
				{
					error: "Invalid request",
					errors: {
						params: !paramsParse.success ? paramsParse.error.flatten() : undefined,
						body: !bodyParse.success ? bodyParse.error.flatten() : undefined,
					},
				},
			];
		}

		const { id } = paramsParse.data;
		const { user_id, items, client_seed } = bodyParse.data;

		const redis = await getRedisConnection();
		if (!redis) return [500, { error: "Failed to connect to Redis" }];

		const connection = await getPostgresConnection();
		let response: [number, Record<string, unknown>] = [500, { error: "Unknown error" }];
		try {
			const jackpotManager = new JackpotRedisManager(redis, request.server);
			const jackpot = await jackpotManager.getJackpot(id);
			if (!jackpot) {
				response = [404, { error: "Jackpot not found" }];
			} else {
				const { rows: confirmed_items } = await connection.query(
					"SELECT user_asset_id FROM item_copies WHERE user_asset_id = ANY($1::text[]) AND owner_id = $2",
					[items, user_id],
				);

				if (confirmed_items.length !== items.length) {
					response = [400, { error: "invalid items" }];
				} else {
					const [user_info] = await getUserInfo(connection, [user_id.toString()]);
					if (!user_info) {
						response = [400, { error: "User not found" }];
					} else {
						const item_ids_string = await getItemString(connection, items);
						const userContributionValue = await getTotalValue(item_ids_string);
						const newMember = {
							player: user_info,
							total_value: userContributionValue,
							items: item_ids_string,
							client_seed,
						} as const;

						const success = await jackpotManager.joinJackpot(id, user_id, newMember);

						response = success
							? [200, { status: "OK", message: "Joined jackpot" }]
							: [409, { error: "Failed to join jackpot" }];

						if (success) {
							// const TEST_USER_IDS = [1, 2, 3];
							// for (const testId of TEST_USER_IDS) {
							// 	try {
							// 		if (testId === user_id) continue;

							// 		const currentJackpot = await jackpotManager.getJackpot(id);
							// 		if (!currentJackpot) break;

							// 		const alreadyInPot = currentJackpot.members.some(
							// 			(m) => m.player.id === testId.toString(),
							// 		);
							// 		if (alreadyInPot || !currentJackpot.joinable) continue;

							// 		const valueCap = currentJackpot.value_cap ?? Number.MAX_SAFE_INTEGER;

							// 		const MAX_ATTEMPTS = 20;
							// 		let selectedUaids: string[] | null = null;
							// 		let selectedValue = 0;

							// 		for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
							// 			const sampleSize = 1 + Math.floor(Math.random() * 30);
							// 			const { rows: sample_items } = await connection.query<{
							// 				user_asset_id: string;
							// 			}>(
							// 				"SELECT user_asset_id FROM item_copies WHERE owner_id = $1 ORDER BY random() LIMIT $2",
							// 				[testId, sampleSize],
							// 			);
							// 			if (sample_items.length === 0) continue;

							// 			const uaidsAttempt = sample_items.map((r) => r.user_asset_id);
							// 			const itemStringAttempt = await getItemString(connection, uaidsAttempt);
							// 			const attemptValue = await getTotalValue(itemStringAttempt);

							// 			if (attemptValue <= valueCap && attemptValue > selectedValue) {
							// 				selectedUaids = itemStringAttempt;
							// 				selectedValue = attemptValue;
							// 				if (selectedValue === valueCap) break;
							// 			}
							// 		}

							// 		if (!selectedUaids) {
							// 			const { rows: bestItem } = await connection.query<{
							// 				user_asset_id: string;
							// 				value: number;
							// 			}>(
							// 				`SELECT ic.user_asset_id, it.value
							// 				 FROM item_copies ic
							// 				 JOIN items it ON it.id = split_part(ic.user_asset_id, ':', 2)::bigint
							// 				 WHERE ic.owner_id = $1 AND it.value <= $2
							// 				 ORDER BY it.value DESC
							// 				 LIMIT 1`,
							// 				[testId, valueCap],
							// 			);

							// 			if (bestItem.length) {
							// 				selectedUaids = await getItemString(connection, [
							// 					bestItem[0].user_asset_id,
							// 				]);
							// 				selectedValue = bestItem[0].value;
							// 			}
							// 		}

							// 		if (!selectedUaids) {
							// 			const { rows: cheapest } = await connection.query<{
							// 				user_asset_id: string;
							// 				value: number;
							// 			}>(
							// 				`SELECT ic.user_asset_id, it.value
							// 				 FROM item_copies ic
							// 				 JOIN items it ON it.id = split_part(ic.user_asset_id, ':', 2)::bigint
							// 				 WHERE ic.owner_id = $1
							// 				 ORDER BY it.value ASC
							// 				 LIMIT 1`,
							// 				[testId],
							// 			);
							// 			if (cheapest.length) {
							// 				selectedUaids = await getItemString(connection, [
							// 					cheapest[0].user_asset_id,
							// 				]);
							// 				selectedValue = cheapest[0].value;
							// 			}
							// 		}

							// 		if (!selectedUaids || selectedUaids.length === 0) continue;

							// 		const item_ids_string = selectedUaids;

							// 		const [test_info] = await getUserInfo(connection, [testId.toString()]);
							// 		if (!test_info) continue;

							// 		const testMember = {
							// 			player: test_info,
							// 			total_value: selectedValue,
							// 			items: item_ids_string,
							// 			client_seed: randomBytes(16).toString("hex"),
							// 		} as const;

							// 		await jackpotManager.joinJackpot(id, testId, testMember);
							// 	} catch (botJoinErr) {
							// 		console.error(
							// 			`[join_pot] Failed to auto-join test user ${testId} to jackpot ${id}:`,
							// 			botJoinErr,
							// 		);
							// 	}
							// }
						}
					}
				}
			}
		} catch (err) {
			console.error("[join_pot] Unexpected error:", err);
			response = [500, { error: "Internal server error" }];
		} finally {
			connection?.release();
		}

		return response;
	},
};
