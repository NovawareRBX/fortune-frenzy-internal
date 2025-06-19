import { FastifyRequest } from "fastify";
import { z } from "zod";
import { getPostgresConnection } from "../../service/postgres";

interface CashChangeRequest {
	user_id: bigint;
	amount: bigint;
}

// Zod schema for headers validation
const getCashChangesHeadersSchema = z.object({
	"user-ids": z.string().min(1),
});

export default {
	method: "GET",
	url: "/users/get-cash-changes",
	authType: "key",
	callback: async function handleRequest(request: FastifyRequest): Promise<[number, any]> {
		const connection = await getPostgresConnection();
		if (!connection) {
			return [500, { error: "Failed to connect to the database" }];
		}

		try {
			// Validate headers using Zod
			const headerParse = getCashChangesHeadersSchema.safeParse(request.headers as any);
			if (!headerParse.success) {
				return [400, { error: "Invalid request", errors: headerParse.error.flatten() }];
			}

			const userIdsHeader = headerParse.data["user-ids"];

			const userIds = userIdsHeader.split(",").map((id) => id.trim());
			if (!userIds.length) {
				return [400, { error: "No user-ids found in header" }];
			}

			await connection.query('BEGIN');
			const { rows } = await connection.query<CashChangeRequest>(
				`SELECT user_id, amount FROM external_cash_change_requests WHERE status = 'pending' AND user_id = ANY($1::bigint[]) FOR UPDATE`,
				[userIds.map((id) => BigInt(id))],
			);

			if (rows.length === 0) {
				await connection.query('ROLLBACK');
				return [200, { status: "OK", changes: [] }];
			}

			const changes = rows.map((row) => ({
				user_id: row.user_id,
				amount: row.amount,
			}));

			await connection.query(
				`UPDATE external_cash_change_requests SET status = 'processed', processed_at = CURRENT_TIMESTAMP WHERE user_id = ANY($1::bigint[]) AND status = 'pending'`,
				[rows.map((row) => row.user_id)],
			);

			await connection.query('COMMIT');

			return [200, { status: "OK", changes }];
		} catch (error) {
			await connection.query('ROLLBACK');
			return [500, { error: "Internal Server Error" }];
		} finally {
			await connection.release();
		}
	}
};
