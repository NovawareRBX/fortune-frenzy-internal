import { FastifyRequest } from "fastify";
import { getMariaConnection } from "../../service/mariadb";
import smartQuery from "../../utilities/smartQuery";

export default async function (request: FastifyRequest<{ Params: { id: string } }>): Promise<[number, any]> {
	const connection = await getMariaConnection();
	if (!connection) {
		return [500, { error: "Failed to connect to the database" }];
	}

	try {
		const owners = await smartQuery(
			connection,
			"SELECT i.*, u.name AS username, u.display_name FROM item_copies i LEFT JOIN users u ON i.owner_id = u.user_id WHERE i.item_id = ?;",
			[request.params.id],
		);

		return [200, { status: "OK", owners }];
	} catch (error) {
		console.error("Error fetching items:", error);
		return [500, { error: "Internal Server Error" }];
	} finally {
		await connection.release();
	}
}
