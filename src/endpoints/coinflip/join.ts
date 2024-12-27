import { FastifyRequest } from "fastify";
import { getRedisConnection } from "../../service/redis";
import { getMariaConnection } from "../../service/mariadb";
import getItemString from "../../utilities/getItemString";
import getUserInfo from "../../utilities/getUserInfo";

export default async function (
	request: FastifyRequest<{
		Params: { coinflip_id: string };
		Body: { user_id: number; items: string[] };
	}>,
): Promise<[number, any]> {
	const { coinflip_id } = request.params;
	const { user_id, items } = request.body;

	if (
		!user_id ||
		typeof user_id !== "number" ||
		!Array.isArray(items) ||
		!items.every((item) => typeof item === "string" && item.startsWith("FF")) ||
		!coinflip_id ||
		typeof coinflip_id !== "string"
	) {
		return [400, { error: "Invalid request" }];
	}

	const redis = await getRedisConnection();
	const connection = await getMariaConnection();

	if (!connection) {
		return [500, { error: "Failed to connect to the database" }];
	}

	try {
		const active_coinflips = await redis.keys(`coinflip:*:user:${user_id}`);
		if (active_coinflips.length > 0) {
			return [400, { error: "Active coinflip already exists" }];
		}

		const coinflipRaw = await redis.get(`coinflip:${coinflip_id}`);
		if (!coinflipRaw) {
			return [400, { error: "Invalid or unavailable coinflip" }];
		}

		const coinflip = JSON.parse(coinflipRaw);
		if (coinflip.status !== "waiting_for_player") {
			return [400, { error: "Coinflip cannot be joined" }];
		}

		if (coinflip.player1.id === user_id) {
			return [400, { error: "Cannot join your own coinflip" }];
		}

		const confirmed_items = await connection.query(
			"SELECT user_asset_id FROM item_copies WHERE user_asset_id IN (?) AND owner_id = ?",
			[items, user_id],
		);

		if (confirmed_items.length !== items.length) {
			return [400, { error: "Invalid items" }];
		}

		const [player2_item_ids_string] = await Promise.all([getItemString(connection, items)]);
		const [player2_info] = await getUserInfo(connection, [user_id.toString()]);

		coinflip.player2 = player2_info;
		coinflip.player2_items = player2_item_ids_string
		coinflip.status = "awaiting_confirmation";
		await redis.set(`coinflip:${coinflip_id}`, JSON.stringify(coinflip), { EX: 3600 });
		
		return [
			200,
			{
				status: "OK",
				data: coinflip,
			},
		];
	} catch (error) {
		console.error("Failed to join coinflip", error);
		return [500, { error: "Failed to join coinflip" }];
	} finally {
		connection.release();
	}
}
