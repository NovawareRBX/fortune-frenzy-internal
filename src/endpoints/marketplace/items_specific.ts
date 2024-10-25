import { FastifyReply, FastifyRequest } from "fastify";
import { getMariaConnection } from "../../service/mariadb";

export default async function (
	request: FastifyRequest<{ Params: { id: string } }>,
): Promise<[number, any]> {
	const connection = await getMariaConnection();
	if (!connection) {
		return [500, { error: "Failed to connect to the database" }];
	}

	try {
		const item_id = request.params.id;

		const rows = await connection.query("SELECT * FROM items WHERE id = ?", [item_id]);

		if (rows.length === 0) {
			return [404, { error: "Item not found" }];
		}

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
		console.error("Error fetching item:", error);
		return [500, { error: "Internal Server Error" }];
	} finally {
		await connection.release();
	}
}
