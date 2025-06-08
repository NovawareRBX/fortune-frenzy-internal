import { FastifyReply, FastifyRequest } from "fastify";
import { getMariaConnection } from "../../service/mariadb";
import smartQuery from "../../utilities/smartQuery";
import countries from "../../utilities/countries.json";

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
			const { name = "Unknown", display_name = "Unknown", country = "Unknown" } = request.body;
			const user_id = request.params.id;

			if (typeof name !== "string" || name.trim() === "") {
				return [400, { error: "Invalid 'name' provided" }];
			}

			if (typeof display_name !== "string" || display_name.trim() === "") {
				return [400, { error: "Invalid 'display_name' provided" }];
			}

			if (typeof user_id !== "string" || user_id.trim() === "") {
				return [400, { error: "Invalid 'id' provided" }];
			}

			if (typeof country !== "string" || country.trim() === "" || !countries.hasOwnProperty(country)) {
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
