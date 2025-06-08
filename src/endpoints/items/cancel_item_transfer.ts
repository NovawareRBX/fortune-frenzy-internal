import { FastifyRequest } from "fastify";
import { getMariaConnection } from "../../service/mariadb";
import query from "../../utilities/smartQuery";

export default {
	method: "POST",
	url: "/items/item-transfer/:transfer_id/cancel",
	authType: "none",
	callback: async function (
		request: FastifyRequest<{
			Params: {
				transfer_id: string;
			};
			Body: {
				reason?: string;
			};
		}>,
	): Promise<[number, any]> {
		const connection = await getMariaConnection();
		if (!connection) {
			return [500, { error: "Failed to connect to the database" }];
		}

		try {
			const { transfer_id } = request.params;
			const { reason } = request.body || {};

			if (!transfer_id || typeof transfer_id !== "string") {
				return [400, { error: "Invalid request" }];
			}

			await connection.beginTransaction();

			// Get transfer and check if it exists
			const [transfer] = await query(connection, "SELECT * FROM item_transfers WHERE transfer_id = ?", [transfer_id]);
			if (!transfer) {
				await connection.rollback();
				return [404, { error: "Transfer not found" }];
			}

			// Check if transfer is already confirmed
			if (transfer.status === 'confirmed') {
				await connection.rollback();
				return [400, { error: "Cannot cancel confirmed transfer" }];
			}

			// Get all items in the transfer
			const items = await query<
				{
					id: number;
					transfer_id: string;
					user_id: string;
					item_uaid: string;
				}[]
			>(connection, "SELECT * FROM item_transfer_items WHERE transfer_id = ?", [transfer_id]);

			if (items.length === 0) {
				// If no items, just delete the transfer
				await query(connection, "DELETE FROM item_transfers WHERE transfer_id = ?", [transfer_id]);
				await connection.commit();
				return [200, { status: "OK", message: "Transfer canceled (no items found)" }];
			}

			// Mark transfer as canceled
			await query(
				connection,
				"UPDATE item_transfers SET status = 'canceled', cancel_reason = ? WHERE transfer_id = ?",
				[reason || 'Manual cancellation', transfer_id]
			);

			await connection.commit();

			return [200, { status: "OK", message: "Transfer canceled successfully" }];
		} catch (error) {
			console.error("cancel_item_transfer", error);
			await connection.rollback();

			return [500, { error: "Failed to cancel transfer" }];
		} finally {
			connection.release();
		}
	}
}; 