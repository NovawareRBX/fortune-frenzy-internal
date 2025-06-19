import { FastifyRequest } from "fastify";
import { getPostgresConnection } from "../../service/postgres";
import { getRedisConnection } from "../../service/redis";
import { z } from "zod";

const itemParamsSchema = z.object({
	id: z.string(),
});

export default {
	method: "GET",
	url: "/marketplace/items/:id",
	authType: "none",
	callback: async function (request: FastifyRequest<{ Params: { id: string } }>): Promise<[number, any]> {
		const connection = await getPostgresConnection();
		if (!connection) {
			return [500, { error: "Failed to connect to the database" }];
		}

		try {
			const paramsParse = itemParamsSchema.safeParse(request.params);
			if (!paramsParse.success) {
				return [400, { error: "Invalid request", errors: paramsParse.error.flatten() }];
			}
			const { id: item_id } = paramsParse.data;

			const redis = await getRedisConnection();
			const cacheKey = `item:${item_id}`;
			const cached = await redis.get(cacheKey);
			if (cached) {
				return [200, { status: "OK", data: JSON.parse(cached) }];
			}

			const { rows } = await connection.query("SELECT * FROM items WHERE id = $1", [item_id]);
			const result = rows[0];

			if (!result) {
				return [404, { error: "Item not found" }];
			}

			if (result) {
				await redis.set(cacheKey, JSON.stringify(result), { EX: 300 }); // cache 5 minutes
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
