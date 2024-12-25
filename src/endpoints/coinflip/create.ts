import { FastifyRequest } from "fastify";
import { getMariaConnection } from "../../service/mariadb";
import query from "../../utilities/smartQuery";
import { randomBytes } from "crypto";
import getItemString from "../../utilities/getItemString";

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
		// first get the total number of active coinflips globally
		const global_coinflips = await query(
			connection,
			"SELECT COUNT(*) AS count FROM coinflips WHERE status != 'completed'",
		);

		if (global_coinflips[0].count >= 300) {
			await connection.rollback();
			return [400, { error: "Too many active coinflips" }];
		}

		const active_coinflips = await query(
			connection,
			'SELECT * FROM coinflips WHERE (player1 = ? OR player2 = ?) AND status != "completed"',
			[user_id, user_id],
		);

		if (active_coinflips.length > 0) {
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

		const item_ids_string = getItemString(connection, items);

		const [user_row] = await query(connection, "SELECT * FROM users WHERE user_id = ?", [`${user_id}`]);

		await connection.commit();
		return [
			200,
			{
				status: "OK",
				data: {
					id: coinflip_id,
					player1: {
						id: user_id,
						username: user_row.name,
						display_name: user_row.displayName,
					},
					player2: null,
					player1_items: item_ids_string,
					player2_items: null,
					status: "waiting_for_player",
					transfer_id: null,
					type: request.body.type,
					server_id,
					player1_coin: coin,
					winning_coin: null,
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
