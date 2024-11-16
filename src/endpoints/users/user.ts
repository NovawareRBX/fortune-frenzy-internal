import { FastifyReply, FastifyRequest } from "fastify";
import { getMariaConnection } from "../../service/mariadb";
import smartQuery from "../../utilities/smartQuery";

export default async function (
	request: FastifyRequest<{ Params: { id: string }; Body: { name?: string; displayName?: string } }>,
): Promise<[number, any]> {
	const connection = await getMariaConnection();
	if (!connection) {
		return [500, { error: "Failed to connect to the database" }];
	}

	try {
		const { name = "Unknown", displayName = "Unknown" } = request.body;
		const user_id = request.params.id;

		if (typeof name !== "string" || name.trim() === "") {
			return [400, { error: "Invalid 'name' provided" }];
		}

		if (typeof displayName !== "string" || displayName.trim() === "") {
			return [400, { error: "Invalid 'displayName' provided" }];
		}

		if (typeof user_id !== "string" || user_id.trim() === "") {
			return [400, { error: "Invalid 'id' provided" }];
		}

		await connection.query(
			`
            INSERT INTO users (user_id, name, displayName) 
            VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE 
              name = VALUES(name), 
              displayName = VALUES(displayName)
            `,
			[user_id, name, displayName],
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
		console.error("Error fetching user:", error);
		return [500, { error: "Internal Server Error" }];
	} finally {
		await connection.release();
	}
}
