import { FastifyRequest } from "fastify";
import { getMariaConnection } from "../../service/mariadb";
import query from "../../utilities/smartQuery";
import getItemString from "../../utilities/getItemString";

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

	const connection = await getMariaConnection();
	if (!connection) {
		return [500, { error: "Failed to connect to the database" }];
	}

	try {
		await connection.beginTransaction();

		const active_coinflips = await query(
			connection,
			'SELECT * FROM coinflips WHERE (player1 = ? OR player2 = ?) AND status != "completed"',
			[user_id, user_id],
		);

		if (active_coinflips.length > 0) {
			await connection.rollback();
			return [400, { error: "Active coinflip already exists" }];
		}

		const coinflip = await query(
			connection,
			`SELECT * FROM coinflips WHERE id = ? AND status = "waiting_for_players" FOR UPDATE`,
			[coinflip_id],
		);
		if (coinflip.length === 0) {
			await connection.rollback();
			return [400, { error: "Invalid or unavailable coinflip" }];
		}

		if (coinflip[0].player1 === user_id) {
			await connection.rollback();
			return [400, { error: "Cannot join your own coinflip" }];
		}

		const confirmed_items = await query(
			connection,
			`SELECT user_asset_id FROM item_copies WHERE user_asset_id IN (?) AND owner_id = ?`,
			[items, user_id],
		);
		if (confirmed_items.length !== items.length) {
			await connection.rollback();
			return [400, { error: "Invalid items" }];
		}

		const [player2_item_ids_string, player1_item_ids_string] = await Promise.all([
			getItemString(connection, items),
			getItemString(connection, coinflip[0].player1_items.split(",")),
		]);

		await query(
			connection,
			`UPDATE coinflips SET player2 = ?, player2_items = ?, status = 'awaiting_confirmation' WHERE id = ?`,
			[user_id, items.join(","), coinflip_id],
		);

		await connection.commit();
		return [
			200,
			{
				status: "OK",
				data: {
					coinflip_id,
					player1: coinflip[0].player1,
					player2: String(user_id),
					player1_items: player1_item_ids_string,
					player2_items: player2_item_ids_string,
					status: "awaiting_confirmation",
					transfer_id: null,
					type: coinflip[0].type,
					server_id: coinflip[0].server_id,
					player1_coin: coinflip[0].player1_coin,
					winning_coin: null,
				},
			},
		];
	} catch (error) {
		console.error("Failed to join coinflip", error);
		await connection.rollback();
		return [500, { error: "Failed to join coinflip" }];
	} finally {
		connection.release();
	}
}
