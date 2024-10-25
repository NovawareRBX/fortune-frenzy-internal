import { FastifyReply, FastifyRequest } from "fastify";
import { getMariaConnection } from "../../service/mariadb";

export default async function (): Promise<[number, any]> {
	const connection = await getMariaConnection();
	if (!connection) {
		return [500, { error: "Failed to connect to the database" }];
	}

	try {
		const rows = await connection.query("SELECT * FROM items");
		const result = rows.map((row: any) => {
			Object.keys(row).forEach((key) => typeof row[key] === "bigint" && (row[key] = row[key].toString()));
			return row;
		});

		return [200, { status: "OK", data: result }];
	} catch (error) {
		console.error("Error fetching items:", error);
		return [500, { error: "Internal Server Error" }];
	} finally {
		await connection.release();
	}
}
