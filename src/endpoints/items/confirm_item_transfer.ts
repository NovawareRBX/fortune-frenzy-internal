import { FastifyRequest } from "fastify";
import { getMariaConnection } from "../../service/mariadb";
import query from "../../utilities/smartQuery";
import { randomBytes } from "crypto";
import discordLog from "../../utilities/discordLog";

export default async function (
	request: FastifyRequest<{
		Body: {
			user_id: string;
		};
		Params: {
			transfer_id: string;
		};
	}>,
): Promise<[number, any]> {
	const connection = await getMariaConnection();
	if (!connection) {
		return [500, { error: "Failed to connect to the database" }];
	}

	try {
		if (
			!request.body ||
			!request.params.transfer_id ||
			!request.body.user_id ||
			typeof request.params.transfer_id !== "string" ||
			typeof request.body.user_id !== "string"
		) {
			return [400, { error: "Invalid request" }];
		}

		const transfer_id = request.params.transfer_id;
		const user_id = request.body.user_id;
		await connection.beginTransaction();

		const [transfer] = await query(connection, "SELECT * FROM item_transfers WHERE transfer_id = ?", [transfer_id]);
		if (!transfer) {
			await connection.rollback();
			return [404, { error: "Transfer not found" }];
		}

		const items = await query<
			{
				id: number;
				transfer_id: string;
				user_id: string;
				item_uaid: string;
			}[]
		>(connection, "SELECT * FROM item_transfer_items WHERE transfer_id = ?", [transfer_id]);
		if (items.length === 0) {
			await query(connection, "DELETE FROM item_transfers WHERE transfer_id = ?", [transfer_id]);
			await connection.commit();
			return [404, { error: "No items in transfer" }];
		}

		const userasset_pairs = items.map((item) => [item.user_id, item.item_uaid]);
		const ownedItems = await query<
			{
				owner_id: string;
				user_asset_id: string;
			}[]
		>(
			connection,
			`SELECT owner_id, user_asset_id FROM item_copies WHERE (owner_id, user_asset_id) IN (${userasset_pairs
				.map(() => "(?, ?)")
				.join(", ")}) FOR UPDATE NOWAIT`,
			userasset_pairs.flat(),
		);

		const owned_set = new Set(ownedItems.map((item) => `${item.owner_id}_${item.user_asset_id}`));
		for (const item of items) {
			if (!owned_set.has(`${item.user_id}_${item.item_uaid}`)) {
				await query(connection, "DELETE FROM item_transfers WHERE transfer_id = ?", [transfer_id]);
				await connection.commit();
				return [403, { error: "Item not owned by user" }];
			}
		}

		await query(
			connection,
			`UPDATE item_copies SET owner_id = ? WHERE user_asset_id IN (${items.map(() => "?").join(", ")})`,
			[user_id, ...items.map((item) => item.item_uaid)],
		);

		await query(connection, "UPDATE item_transfers SET status = 'confirmed' WHERE transfer_id = ?", [transfer_id]);
		await connection.commit();

		discordLog(
			"Log",
			"Item Transfer Confirmed",
			`Item transfer has been confirmed.\n\`\`\`json\n${JSON.stringify(
				{
					transfer_id,
					user_id,
				},
				null,
				2,
			)}\n\`\`\``,
		);

		return [200, { status: "OK" }];
	} catch (error) {
		discordLog(
			"Danger",
			"Item Transfer Failed",
			`Failed to process item transfer.\n\`\`\`json\n${JSON.stringify(
				{
					transfer_id: request.params.transfer_id,
					user_id: request.body.user_id,
					error,
				},
				null,
				2,
			)}\n\`\`\``,
		);

		await connection.rollback();
		return [500, { error: "Failed to create transfer" }];
	} finally {
		connection.release();
	}
}
