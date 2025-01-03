import { FastifyRequest } from "fastify";
import { getMariaConnection } from "../../service/mariadb";
import { getRedisConnection } from "../../service/redis";
import { randomBytes } from "crypto";
import getItemString from "../../utilities/getItemString";
import getUserInfo from "../../utilities/getUserInfo";

export default async function (
	request: FastifyRequest<{
		Params: { server_id: string };
		Body: {
			user_id: Number;
			items: Array<string>;
			coin: 1 | 2;
			type: "server" | "global" | "friends";
		};
	}>,
): Promise<[number, any]> {
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
		return [400, { error: "Invalid request" }];
	}

	const server_id = request.params.server_id;
	const user_id = request.body.user_id;
	const items = request.body.items;
	const coin = request.body.coin;

	const redis = await getRedisConnection();
	const connection = await getMariaConnection();

	if (!connection) {
		return [500, { error: "Failed to connect to the database" }];
	}

	try {
		const confirmed_items = await connection.query(
			"SELECT user_asset_id FROM item_copies WHERE user_asset_id IN (?) AND owner_id = ?",
			[items, user_id],
		);

		if (confirmed_items.length !== items.length) {
			return [400, { error: "Invalid items" }];
		}

		const active_coinflips = await redis.keys(`coinflip:*:user:${user_id}`);
		if (active_coinflips.length > 0) {
			return [400, { error: "Active coinflip already exists" }];
		}

		const total_coinflips = await redis.sCard("coinflips:global");
		if (total_coinflips >= 300) {
			return [400, { error: "Too many active coinflips" }];
		}

		const coinflip_id = randomBytes(20).toString("base64").replace(/[+/=]/g, "").substring(0, 20);

		const [user_info] = await getUserInfo(connection, [user_id.toString()]);
		const item_ids_string = await getItemString(connection, items);

		const coinflip_data = {
			id: coinflip_id,
			player1: user_info,
			player2: null,
			player1_items: item_ids_string,
			player2_items: null,
			status: "waiting_for_player",
			type: request.body.type,
			server_id,
			player1_coin: coin,
			winning_coin: null,
		};

		await redis
			.multi()
			.set(`coinflip:${coinflip_id}`, JSON.stringify(coinflip_data), {
				EX: 3600,
			})
			.sAdd(`coinflips:server:${server_id}`, coinflip_id)
			.sAdd("coinflips:global", coinflip_id)
			.set(`coinflip:${coinflip_id}:user:${user_id}`, "active", { EX: 3600 })
			.exec();

		return [
			200,
			{
				status: "OK",
				data: coinflip_data,
			},
		];
	} catch (error) {
		console.error("Error creating coinflip:", error);
		return [500, { error: "Failed to create coinflip" }];
	} finally {
		connection.release();
	}
}

export interface CoinflipData {
	id: string;
	player1: {
		id: number;
		username?: string;
		display_name?: string;
	};
	player2?: {
		id: number;
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
}
