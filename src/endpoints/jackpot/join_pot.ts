import { FastifyRequest } from "fastify";
import { getRedisConnection } from "../../service/redis";
import { z } from "zod";
import { JackpotRedisManager } from "../../service/jackpot/jackpot-redis";
import { getPostgresConnection } from "../../service/postgres";
import getUserInfo from "../../utilities/getUserInfo";
import getItemString from "../../utilities/getItemString";
import getTotalValue from "../../utilities/getTotalValue";

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
						const newMember = {
							player: user_info,
							total_value: await getTotalValue(item_ids_string),
							items: item_ids_string,
							client_seed,
						} as const;

						const success = await jackpotManager.joinJackpot(id, user_id, newMember);

						response = success
							? [200, { status: "OK", message: "Joined jackpot" }]
							: [409, { error: "Failed to join jackpot" }];
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
