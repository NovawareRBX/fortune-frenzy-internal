import { FastifyReply, FastifyRequest } from "fastify";
import { getMariaConnection } from "../../service/mariadb";
import smartQuery from "../../utilities/smartQuery";

export default async function (request: FastifyRequest<{ Params: { id: string } }>): Promise<[number, any]> {
	const connection = await getMariaConnection();
	if (!connection) {
		return [500, { error: "Failed to connect to the database" }];
	}

	try {
		const user_id = request.params.id;
		await connection.query("INSERT IGNORE INTO users (user_id) VALUES (?)", [user_id]);

		const rows = await smartQuery(
			connection,
			"SELECT copy_id, item_id, user_asset_id, serial_number FROM item_copies WHERE owner_id = ?",
			[user_id],
		);

		return [
			200,
			{
				status: "OK",
				inventory: rows,
			},
		];
	} catch (error) {
		console.error("Error fetching user inventory:", error);
		return [500, { error: "Internal Server Error" }];
	} finally {
		await connection.release();
	}
}
