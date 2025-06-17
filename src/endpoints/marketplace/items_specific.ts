import { FastifyReply, FastifyRequest } from "fastify";
import { getMariaConnection } from "../../service/mariadb";
import smartQuery from "../../utilities/smartQuery";
import { z } from "zod";

const itemParamsSchema = z.object({
	id: z.string(),
});

export default {
	method: "GET",
	url: "/marketplace/items/:id",
	authType: "none",
	callback: async function (request: FastifyRequest<{ Params: { id: string } }>): Promise<[number, any]> {
		const connection = await getMariaConnection();
		if (!connection) {
			return [500, { error: "Failed to connect to the database" }];
		}

		try {
			const paramsParse = itemParamsSchema.safeParse(request.params);
			if (!paramsParse.success) {
				return [400, { error: "Invalid request", errors: paramsParse.error.flatten() }];
			}
			const { id: item_id } = paramsParse.data;

			const [result] = await smartQuery(connection, "SELECT * FROM items WHERE id = ?", [item_id]);

			if (!result) {
				return [404, { error: "Item not found" }];
			}

			return [
				200,
				{
					status: "OK",
					data: result,
				},
			];
		} catch (error) {
			console.error("Error fetching item:", error);
			return [500, { error: "Internal Server Error" }];
		} finally {
			await connection.release();
		}
	}
};
