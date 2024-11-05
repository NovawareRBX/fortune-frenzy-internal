import { FastifyReply, FastifyRequest } from "fastify";
import { getMariaConnection } from "../../service/mariadb";

export default async function (request: FastifyRequest<{ Params: { id: string } }>): Promise<[number, any]> {
	const connection = await getMariaConnection();
	if (!connection) {
		return [500, { error: "Failed to connect to the database" }];
	}

	try {
		const user_id = request.params.id;
		await connection.query("INSERT IGNORE INTO users (user_id) VALUES (?)", [user_id]);

		const rows = await connection.query(
			"SELECT copy_id, item_id, user_asset_id, serial_number FROM item_copies WHERE owner_id = ?",
			[user_id],
		);
		const result = rows.map((row: any) => {
			Object.keys(row).forEach((key) => typeof row[key] === "bigint" && (row[key] = row[key].toString()));
			return [row.item_id, row.user_asset_id, row.serial_number.toString(), row.copy_id.toString()];
		});

		return [
			200,
			{
				status: "OK",
				inventory: result,
			},
		];
	} catch (error) {
		console.error("Error fetching user inventory:", error);
		return [500, { error: "Internal Server Error" }];
	} finally {
		await connection.release();
	}
}
