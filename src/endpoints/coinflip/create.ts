import { FastifyRequest } from "fastify";
import { getMariaConnection } from "../../service/mariadb";
import { getRedisConnection } from "../../service/redis";
import { randomBytes } from "crypto";
import getItemString from "../../utilities/getItemString";
import getUserInfo from "../../utilities/getUserInfo";
import { CoinflipRedisManager } from "../../service/coinflip-redis";

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
		// basic validation
		if (
			!request.body ||
			typeof request.body.user_id !== "number" ||
			!Array.isArray(request.body.items) ||
			!request.body.items.every((item) => typeof item === "string" && item.startsWith("FF")) ||
			(request.body.coin !== 1 && request.body.coin !== 2) ||
			!request.params.server_id ||
			typeof request.params.server_id !== "string" ||
			request.params.server_id.length < 1
		) {
			return [400, { error: "invalid request" }];
		}

		const server_id = request.params.server_id;
		const user_id = request.body.user_id;
		const items = request.body.items;
		const coin = request.body.coin;

		const redis = await getRedisConnection();
		const connection = await getMariaConnection();
		if (!connection || !redis) return [500, { error: "failed to connect to the database" }];

		const coinflipManager = new CoinflipRedisManager(redis, request.server);

		try {
			const confirmed_items = await connection.query(
				"SELECT user_asset_id FROM item_copies WHERE user_asset_id IN (?) AND owner_id = ?",
				[items, user_id],
			);
			if (confirmed_items.length !== items.length) return [400, { error: "invalid items" }];

			const [user_info] = await getUserInfo(connection, [user_id.toString()]);
			const item_ids_string = await getItemString(connection, items);
			const coinflip_id = randomBytes(20).toString("base64").replace(/[+/=]/g, "").substring(0, 20);

			const coinflip_data: CoinflipData = {
				id: coinflip_id,
				player1: {
					id: user_id.toString(),
					username: user_info.username,
					display_name: user_info.display_name
				},
				player1_items: item_ids_string,
				status: "waiting_for_player",
				type: request.body.type,
				server_id,
				player1_coin: coin,
			};

			const success = await coinflipManager.createCoinflip(coinflip_data);
			if (!success) {
				return [500, { error: "failed to create coinflip" }];
			}

			return [
				200,
				{
					status: "OK",
					data: coinflip_data,
				},
			];
		} catch (error) {
			return [500, { error: "failed to create coinflip" }];
		} finally {
			connection.release();
		}
	}
};
