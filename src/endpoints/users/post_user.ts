import { FastifyReply, FastifyRequest } from "fastify";
import { getMariaConnection } from "../../service/mariadb";
import smartQuery from "../../utilities/smartQuery";
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
		const connection = await getMariaConnection();
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
				`
                INSERT INTO users (user_id, name, display_name, country) 
                VALUES (?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE 
                  name = VALUES(name), 
                  display_name = VALUES(display_name),
                  country = VALUES(country)
                `,
				[user_id, name, display_name, country],
			);

			const [result] = await smartQuery(connection, "SELECT * FROM users WHERE user_id = ?", [user_id]);

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
