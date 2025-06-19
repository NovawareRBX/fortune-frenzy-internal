import { FastifyRequest } from "fastify";
import { getPostgresConnection } from "../../service/postgres";
import { z } from "zod";

const userParamSchema = z.object({ id: z.string().regex(/^\d+$/) });

export default {
	method: "GET",
	url: "/users/:id",
	authType: "none",
	callback: async function (request: FastifyRequest<{ Params: { id: string } }>): Promise<[number, any]> {
		const paramsParse = userParamSchema.safeParse(request.params);
		if (!paramsParse.success) {
			return [400, { error: "Invalid request", errors: paramsParse.error.flatten() }];
		}
		const user_id = parseInt(paramsParse.data.id);
		const connection = await getPostgresConnection();
		if (!connection) return [500, { error: "Failed to connect to the database" }];

		try {
			const {
				rows: [data],
			} = await connection.query(`SELECT * FROM users WHERE user_id = $1`, [user_id]);

			const { rows: recent_activity } = await connection.query(
				`SELECT image, text FROM recent_game_activity WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10`,
				[user_id],
			);

			if (!data) return [404, { error: "User not found" }];

			return [
				200,
				{
					status: "OK",
					data: {
						data,
						recent_activity,
					},
				},
			];
		} catch (error) {
			console.error(error);
			return [500, { error: "Failed to get user count" }];
		} finally {
			connection.release();
		}
	},
};
