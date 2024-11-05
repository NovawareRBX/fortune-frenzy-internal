import { FastifyRequest } from "fastify";
import { getMariaConnection } from "../../service/mariadb";

function convertBigIntToString(obj: Record<string, any>): Record<string, any> {
	Object.keys(obj).forEach((key) => {
		if (typeof obj[key] === "bigint") {
			obj[key] = obj[key].toString();
		}
	});
	return obj;
}

export default async function (request: FastifyRequest<{ Params: { id: string } }>): Promise<[number, any]> {
	const connection = await getMariaConnection();
	if (!connection) {
		return [500, { error: "Failed to connect to the database" }];
	}

	try {
		const query = "SELECT i.*, u.name AS username, u.displayName FROM item_copies i LEFT JOIN users u ON i.owner_id = u.user_id WHERE i.item_id = ?;";

		const rows = await connection.query(query, [request.params.id]);
		const owners = rows.map((row: any) => convertBigIntToString(row));

		return [200, { status: "OK", owners }];
	} catch (error) {
		console.error("Error fetching items:", error);
		return [500, { error: "Internal Server Error" }];
	} finally {
		await connection.release();
	}
}
