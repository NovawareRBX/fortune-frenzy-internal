import { FastifyRequest } from "fastify";
import { getRedisConnection } from "../../service/redis";
import { z } from "zod";
import { JackpotRedisManager } from "../../service/jackpot-redis";
import { getMariaConnection } from "../../service/mariadb";
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
		const connection = await getMariaConnection();
		if (!redis || !connection) return [500, { error: "Failed to connect to the database" }];

		const jackpotManager = new JackpotRedisManager(redis, request.server);
		const jackpot = await jackpotManager.getJackpot(id);
		if (!jackpot) return [404, { error: "Jackpot not found" }];

		const confirmed_items = await connection.query(
			"SELECT user_asset_id FROM item_copies WHERE user_asset_id IN (?) AND owner_id = ?",
			[items, user_id],
		);
		if (confirmed_items.length !== items.length) return [400, { error: "invalid items" }];

		const [user_info] = await getUserInfo(connection, [user_id.toString()]);
		if (!user_info) return [400, { error: "User not found" }];

		const item_ids_string = await getItemString(connection, items);

		const newMember = {
			player: user_info,
			total_value: await getTotalValue(item_ids_string),
			items: item_ids_string,
			client_seed,
		} as const;

		const success = await jackpotManager.joinJackpot(id, user_id, newMember);
		if (!success) return [409, { error: "Failed to join jackpot" }];

		return [200, { status: "OK", message: "Joined jackpot" }];
	},
};
