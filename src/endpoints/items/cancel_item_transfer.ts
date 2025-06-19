import { FastifyRequest } from "fastify";
import { getPostgresConnection } from "../../service/postgres";
import { z } from "zod";

const cancelParamsSchema = z.object({
	transfer_id: z.string(),
});

const cancelBodySchema = z.object({
	reason: z.string().optional(),
});

export default {
	method: "POST",
	url: "/items/item-transfer/:transfer_id/cancel",
	authType: "key",
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
		const connection = await getPostgresConnection();
		if (!connection) {
			return [500, { error: "Failed to connect to the database" }];
		}

		try {
			const paramsParse = cancelParamsSchema.safeParse(request.params);
			const bodyParse = cancelBodySchema.safeParse(request.body || {});
			if (!paramsParse.success || !bodyParse.success) {
				return [400, { error: "Invalid request", errors: {
					params: !paramsParse.success ? paramsParse.error.flatten() : undefined,
					body: !bodyParse.success ? bodyParse.error.flatten() : undefined,
				}}];
			}

			const { transfer_id } = paramsParse.data;
			const { reason } = bodyParse.data;

			await connection.query("BEGIN");

			// Get transfer and check if it exists
			const { rows: transferRows } = await connection.query("SELECT * FROM item_transfers WHERE transfer_id = $1", [transfer_id]);
			const transfer = transferRows[0];
			if (!transfer) {
				await connection.query("ROLLBACK");
				return [404, { error: "Transfer not found" }];
			}

			// Check if transfer is already confirmed
			if (transfer.status === 'confirmed') {
				await connection.query("ROLLBACK");
				return [400, { error: "Cannot cancel confirmed transfer" }];
			}

			// Get all items in the transfer
			const { rows: items } = await connection.query<{
				id: number;
				transfer_id: string;
				user_id: string;
				item_uaid: string;
			}>("SELECT * FROM item_transfer_items WHERE transfer_id = $1", [transfer_id]);

			if (items.length === 0) {
				// If no items, just delete the transfer
				await connection.query("DELETE FROM item_transfers WHERE transfer_id = $1", [transfer_id]);
				await connection.query("COMMIT");
				return [200, { status: "OK", message: "Transfer canceled (no items found)" }];
			}

			// Mark transfer as canceled
			await connection.query(
				"UPDATE item_transfers SET status = 'canceled', cancel_reason = $1 WHERE transfer_id = $2",
				[reason || 'Manual cancellation', transfer_id]
			);

			await connection.query("COMMIT");

			return [200, { status: "OK", message: "Transfer canceled successfully" }];
		} catch (error) {
			console.error("cancel_item_transfer", error);
			await connection.query("ROLLBACK");

			return [500, { error: "Failed to cancel transfer" }];
		} finally {
			connection.release();
		}
	}
}; 