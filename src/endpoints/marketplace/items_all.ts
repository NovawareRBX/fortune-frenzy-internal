import { FastifyReply, FastifyRequest } from "fastify";
import { getMariaConnection } from "../../service/mariadb";
import smartQuery from "../../utilities/smartQuery";

export default async function (): Promise<[number, any]> {
	const connection = await getMariaConnection();
	if (!connection) {
		return [500, { error: "Failed to connect to the database" }];
	}

	try {
		const rows = await smartQuery(connection, "SELECT * FROM items");
		return [200, { status: "OK", data: rows }];
	} catch (error) {
		console.error("Error fetching items:", error);
		return [500, { error: "Internal Server Error" }];
	} finally {
		await connection.release();
	}
}
