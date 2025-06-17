import { FastifyRequest } from "fastify";
import { getMariaConnection } from "../../service/mariadb";
import smartQuery from "../../utilities/smartQuery";
import { z } from "zod";

const ownersParamsSchema = z.object({
	id: z.string(),
});

export default {
	method: "GET",
	url: "/marketplace/items/:id/owners",
	authType: "none",
	callback: async function (request: FastifyRequest<{ Params: { id: string } }>): Promise<[number, any]> {
		const connection = await getMariaConnection();
		if (!connection) {
			return [500, { error: "Failed to connect to the database" }];
		}

		try {
			const paramsParse = ownersParamsSchema.safeParse(request.params);
			if (!paramsParse.success) {
				return [400, { error: "Invalid request", errors: paramsParse.error.flatten() }];
			}

			const { id } = paramsParse.data;

			const owners = await smartQuery(
				connection,
				"SELECT i.*, u.name AS username, u.display_name FROM item_copies i LEFT JOIN users u ON i.owner_id = u.user_id WHERE i.item_id = ?;",
				[id],
			);

			return [200, { status: "OK", owners }];
		} catch (error) {
			console.error("Error fetching items:", error);
			return [500, { error: "Internal Server Error" }];
		} finally {
			await connection.release();
		}
	}
};
