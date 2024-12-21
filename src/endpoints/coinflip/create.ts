import { FastifyRequest } from "fastify";
import { getMariaConnection } from "../../service/mariadb";
import query from "../../utilities/smartQuery";
import { randomBytes } from "crypto";

export default async function (
	request: FastifyRequest<{
		Params: { server_id: string };
		Body: { user_id: Number; items: Array<string>; coin: 1 | 2; type: "server" | "global" | "friends" };
	}>,
): Promise<[number, any]> {
	if (
		!request.body ||
		typeof request.body.user_id !== "number" ||
		!Array.isArray(request.body.items) ||
		!request.body.items.every((item) => typeof item === "string" && item.startsWith("FF")) ||
		(request.body.coin !== 1 && request.body.coin !== 2) ||
		!request.params.server_id ||
		typeof request.params.server_id !== "string"
	) {
		return [400, { error: "Invalid request" }];
	}

	const server_id = request.params.server_id;
	const user_id = request.body.user_id;
	const items = request.body.items;
	const coin = request.body.coin;
	const connection = await getMariaConnection();

	if (!connection) {
		return [500, { error: "Failed to connect to the database" }];
	}

	try {
		await connection.beginTransaction();
		const coinflips = await query(connection, `SELECT * FROM coinflips WHERE player1 = ? AND status != "done"`, [
			user_id,
		]);
		if (coinflips.length > 0) {
			await connection.rollback();
			return [400, { error: "Active coinflip already exists" }];
		}

		const confirmed_items = await query(
			connection,
			"SELECT user_asset_id FROM item_copies WHERE user_asset_id IN (?) AND owner_id = ?",
			[items, user_id],
		);
		if (confirmed_items.length !== items.length) {
			await connection.rollback();
			return [400, { error: "Invalid items" }];
		}

		const coinflip_id = randomBytes(20).toString("base64").replace(/[+/=]/g, "").substring(0, 20);
		await query(
			connection,
			"INSERT INTO coinflips (id, player1, player1_items, type, server_id, player1_coin) VALUES (?, ?, ?, ?, ?, ?)",
			[coinflip_id, user_id, items.join(","), request.body.type, server_id, coin],
		);

		const item_ids = await query<Array<{ item_id: string; user_asset_id: string }>>(
			connection,
			`SELECT item_id, user_asset_id FROM item_copies WHERE user_asset_id IN (?)`,
			[items],
		);
		const item_ids_string = item_ids
			.map((item: { item_id: string; user_asset_id: string }) => `${item.user_asset_id}:${item.item_id}`)
			.join(",");

		await connection.commit();
		return [
			200,
			{
				status: "OK",
				data: {
					coinflip_id,
					player1: String(user_id),
					player2: null,
					player1_items: item_ids_string,
					player2_items: null,
					status: "waiting",
					transfer_id: null,
					type: request.body.type,
					server_id,
					player1_coin: coin,
				},
			},
		];
	} catch (error) {
		await connection.rollback();
		console.error("Error creating coinflip:", error);
		return [500, { error: "Failed to create coinflip" }];
	} finally {
		connection.release();
	}
}
