import { FastifyRequest } from "fastify";
import { z } from "zod";
import { getPostgresConnection } from "../../service/postgres";

const userInventoryParamsSchema = z.object({
	id: z.string().regex(/^\d+$/),
});

export default {
	method: "GET",
	url: "/users/:id/inventory",
	authType: "none",
	callback: async function (request: FastifyRequest<{ Params: { id: string } }>): Promise<[number, any]> {
		const connection = await getPostgresConnection();
		if (!connection) {
			return [500, { error: "Failed to connect to the database" }];
		}

		try {
			// Validate params using Zod
			const paramsParse = userInventoryParamsSchema.safeParse(request.params);
			if (!paramsParse.success) {
				return [400, { error: "Invalid request", errors: paramsParse.error.flatten() }];
			}
			const user_id = paramsParse.data.id;

			await connection.query("INSERT INTO users (user_id) VALUES ($1) ON CONFLICT DO NOTHING", [user_id]);

			const { rows } = await connection.query(
				"SELECT copy_id, item_id, user_asset_id, serial_number FROM item_copies WHERE owner_id = $1",
				[user_id],
			);

			return [
				200,
				{
					status: "OK",
					inventory: rows.map((row: any) => [
						row.item_id,
						row.user_asset_id,
						String(row.serial_number),
						row.copy_id,
					]),
				},
			];
		} catch (error) {
			console.error("Error fetching user inventory:", error);
			return [500, { error: "Internal Server Error" }];
		} finally {
			await connection.release();
		}
	}
};
