import { FastifyRequest } from "fastify";
import { getPostgresConnection } from "../../service/postgres";
import countries from "../../utilities/countries.json";
import { z } from "zod";

const postUserParamsSchema = z.object({
	id: z.string().regex(/^\d+$/),
});

const postUserBodySchema = z.object({
	name: z.string().min(1).optional(),
	display_name: z.string().min(1).optional(),
	country: z.string().optional(),
});

export default {
	method: "POST",
	url: "/users/:id",
	authType: "key",
	callback: async function (
		request: FastifyRequest<{
			Params: { id: string };
			Body: { name?: string; display_name?: string; country?: string };
		}>,
	): Promise<[number, any]> {
		const connection = await getPostgresConnection();
		if (!connection) {
			return [500, { error: "Failed to connect to the database" }];
		}

		try {
			const paramsParse = postUserParamsSchema.safeParse(request.params);
			const bodyParse = postUserBodySchema.safeParse(request.body);
			if (!paramsParse.success || !bodyParse.success) {
				return [
					400,
					{
						error: "Invalid request",
						errors: {
							params: !paramsParse.success ? paramsParse.error.flatten() : undefined,
							body: !bodyParse.success ? bodyParse.error.flatten() : undefined,
						},
					},
				];
			}
			const user_id = paramsParse.data.id;
			let { name = "Unknown", display_name = "Unknown", country = "Unknown" } = bodyParse.data;
			if (!(country in countries)) {
				return [400, { error: "Invalid 'country' provided" }];
			}

			await connection.query(
				`INSERT INTO users (user_id, name, display_name, country)
				 VALUES ($1, $2, $3, $4)
				 ON CONFLICT (user_id) DO UPDATE SET
					 name = EXCLUDED.name,
					 display_name = EXCLUDED.display_name,
					 country = EXCLUDED.country`,
				[user_id, name, display_name, country],
			);

			const { rows } = await connection.query("SELECT * FROM users WHERE user_id = $1", [user_id]);
			const result = rows[0];

			return [
				200,
				{
					status: "OK",
					data: result,
				},
			];
		} catch (error) {
			return [500, { error: "Internal Server Error" }];
		} finally {
			await connection.release();
		}
	},
};
