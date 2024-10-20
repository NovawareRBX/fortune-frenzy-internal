import { FastifyReply, FastifyRequest } from "fastify";
import { getMariaConnection } from "../../service/mariadb";

export default async function (
	request: FastifyRequest<{ Params: { id: string } }>,
): Promise<[number, any]> {
	const connection = await getMariaConnection();
	try {
		const user_id = request.params.id;
		await connection.query("INSERT IGNORE INTO users (user_id) VALUES (?)", [user_id]);

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
