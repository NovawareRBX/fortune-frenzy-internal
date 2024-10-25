import { FastifyReply, FastifyRequest } from "fastify";
import { getMariaConnection } from "../../service/mariadb";

interface Body {
	name: string;
	displayName: string;
}

export default async function (request: FastifyRequest<{ Params: { id: string } }>): Promise<[number, any]> {
	const connection = await getMariaConnection();
	if (!connection) {
		return [500, { error: "Failed to connect to the database" }];
	}

	try {
		const { name = "Unknown", displayName = "Unknown" } = request.body as Body;
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

		const rows = await connection.query("SELECT * FROM users WHERE user_id = ?", [user_id]);
		const result = rows[0];

		Object.keys(result).forEach((key) => typeof result[key] === "bigint" && (result[key] = result[key].toString()));

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
