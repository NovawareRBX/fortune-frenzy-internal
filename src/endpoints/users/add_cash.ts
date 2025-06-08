import { FastifyRequest } from "fastify";
import { getMariaConnection } from "../../service/mariadb";

export default {
	method: "POST",
	url: "/users/:id/add-cash",
	authType: "key",
	callback: async function (request: FastifyRequest<{ Params: { id: string } }>): Promise<[number, any]> {
		const connection = await getMariaConnection();
		if (!connection) {
			return [500, { error: "Failed to connect to the database" }];
		}

		try {
			const amount = parseInt(request.headers.amount as string);
			const id = request.params.id;
			if (isNaN(amount)) return [400, { error: "Invalid amount" }];
			const query = `INSERT INTO external_cash_change_requests (user_id, amount, status) VALUES (?, ?, 'pending');`;
			await connection.query(query, [id, amount]);
			return [200, { status: "OK" }];
		} catch (error) {
			console.error("Error fetching user inventory:", error);
			return [500, { error: "Internal Server Error" }];
		} finally {
			await connection.release();
		}
	}
};
