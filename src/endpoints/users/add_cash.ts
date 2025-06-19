import { FastifyRequest } from "fastify";
import { z } from "zod";
import { getPostgresConnection } from "../../service/postgres";

// Zod schemas for validating request params and headers
const addCashParamsSchema = z.object({
	id: z.string().regex(/^\d+$/),
});

const addCashHeadersSchema = z.object({
	amount: z.string().regex(/^[-]?\d+$/),
});

export default {
	method: "POST",
	url: "/users/:id/add-cash",
	authType: "key",
	callback: async function (request: FastifyRequest<{ Params: { id: string } }>): Promise<[number, any]> {
		// Validate request using Zod
		const paramsParse = addCashParamsSchema.safeParse(request.params);
		const headersParse = addCashHeadersSchema.safeParse(request.headers as any);
		if (!paramsParse.success || !headersParse.success) {
			return [
				400,
				{
					error: "Invalid request",
					errors: {
						params: !paramsParse.success ? paramsParse.error.flatten() : undefined,
						headers: !headersParse.success ? headersParse.error.flatten() : undefined,
					},
				},
			];
		}

		const { id } = paramsParse.data;
		const amount = parseInt(headersParse.data.amount, 10);

		const connection = await getPostgresConnection();
		if (!connection) {
			return [500, { error: "Failed to connect to the database" }];
		}

		try {
			await connection.query(
				`INSERT INTO external_cash_change_requests (user_id, amount, status) VALUES ($1, $2, 'pending')`,
				[id, amount],
			);
			return [200, { status: "OK" }];
		} catch (error) {
			console.error("Error fetching user inventory:", error);
			return [500, { error: "Internal Server Error" }];
		} finally {
			await connection.release();
		}
	}
};
