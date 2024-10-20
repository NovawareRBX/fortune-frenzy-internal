import { FastifyRequest } from "fastify";
import { getMariaConnection } from "../../service/mariadb";

interface CashChangeRequest {
	user_id: bigint;
	amount: bigint;
}

export default async function handleRequest(request: FastifyRequest): Promise<[number, any]> {
	const connection = await getMariaConnection();
	try {
		const userIdsHeader = request.headers["user-ids"] as string;
		if (!userIdsHeader) {
			return [400, { error: "Missing user-ids header" }];
		}

		const userIds = userIdsHeader.split(",").map((id) => id.trim());
		if (!userIds.length) {
			return [400, { error: "No user-ids found in header" }];
		}

		const rows = await connection.query<CashChangeRequest[]>(
			`SELECT user_id, amount FROM external_cash_change_requests WHERE status = 'pending' AND user_id IN (?)`,
			[userIds.map((id) => Number(id))],
		);

		if (rows.length === 0) {
			return [200, { status: "OK", changes: [] }];
		}

		const changes = rows.map((row) => ({
			user_id: row.user_id.toString(),
			amount: row.amount.toString(),
		}));

		const userIdsToUpdate = rows.map((row) => row.user_id.toString());
		await connection.query(
			`UPDATE external_cash_change_requests SET status = 'processed', processed_at = CURRENT_TIMESTAMP WHERE user_id IN (?) AND status = 'pending'`,
			[userIdsToUpdate],
		);

		return [200, { status: "OK", changes }];
	} catch (error) {
		console.error("Error fetching or updating external cash change requests:", error);
		return [500, { error: "Internal Server Error" }];
	} finally {
		await connection.release();
	}
}
