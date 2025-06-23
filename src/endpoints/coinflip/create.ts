import { FastifyRequest } from "fastify";
import { getPostgresConnection } from "../../service/postgres";
import { getRedisConnection } from "../../service/redis";
import crypto from "crypto";
import getItemString from "../../utilities/getItemString";
import getUserInfo from "../../utilities/getUserInfo";
import { CoinflipRedisManager } from "../../service/coinflip-redis";
import { z } from "zod";

export interface CoinflipData {
	id: string;
	player1: {
		id: string;
		username?: string;
		display_name?: string;
	};
	player2?: {
		id: string;
		username?: string;
		display_name?: string;
	};
	player1_items: string[];
	player2_items?: string[];
	status: "waiting_for_player" | "awaiting_confirmation" | "completed" | "failed";
	type: "server" | "global" | "friends";
	server_id: string;
	player1_coin: 1 | 2;
	winning_coin?: 1 | 2;
	transfer_id?: string;
	auto_id?: number;
}

const createParamsSchema = z.object({
	server_id: z.string().min(1),
});

const createBodySchema = z.object({
	user_id: z.number(),
	items: z.array(z.string().regex(/^FF/)).min(1),
	coin: z.union([z.literal(1), z.literal(2)]),
	type: z.enum(["server", "global", "friends"]),
});

export default {
	method: "POST",
	url: "/coinflip/create/:server_id",
	authType: "key",
	callback: async function(
		request: FastifyRequest<{
			Params: { server_id: string };
			Body: { user_id: number; items: Array<string>; coin: 1 | 2; type: "server" | "global" | "friends" };
		}>,
	): Promise<[number, any]> {
		const paramsParse = createParamsSchema.safeParse(request.params);
		const bodyParse = createBodySchema.safeParse(request.body);
		if (!paramsParse.success || !bodyParse.success) {
			return [400, { error: "invalid request", errors: {
				params: !paramsParse.success ? paramsParse.error.flatten() : undefined,
				body: !bodyParse.success ? bodyParse.error.flatten() : undefined,
			}}];
		}

		const { server_id } = paramsParse.data;
		const { user_id, items, coin, type } = bodyParse.data;

		const redis = await getRedisConnection();
		const connection = await getPostgresConnection();
		if (!connection || !redis) return [500, { error: "Failed to connect to the database" }];

		const coinflipManager = new CoinflipRedisManager(redis, request.server);

		try {
			const { rows: confirmed_items } = await connection.query<{ user_asset_id: string }>(
				"SELECT user_asset_id FROM item_copies WHERE user_asset_id = ANY($1::text[]) AND owner_id = $2",
				[items, user_id],
			);
			if (confirmed_items.length !== items.length) return [400, { error: "Invalid items" }];

			const [user_info] = await getUserInfo(connection, [user_id.toString()]);
			const item_ids_string = await getItemString(connection, items);
			const coinflip_id = crypto.randomUUID();

			const coinflip_data: CoinflipData = {
				id: coinflip_id,
				player1: {
					id: user_id.toString(),
					username: user_info.username,
					display_name: user_info.display_name
				},
				player1_items: item_ids_string,
				status: "waiting_for_player",
				type,
				server_id,
				player1_coin: coin,
			};

			const success = await coinflipManager.createCoinflip(coinflip_data);
			if (!success) {
				return [500, { error: "Failed to create coinflip" }];
			}

			return [
				200,
				{
					status: "OK",
					data: coinflip_data,
				},
			];
		} catch (error) {
			return [500, { error: "Failed to create coinflip" }];
		} finally {
			connection.release();
		}
	}
};
