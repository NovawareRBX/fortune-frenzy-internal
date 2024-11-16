import { FastifyRequest } from "fastify";
import { getMariaConnection } from "../../service/mariadb";
import { ItemListing } from "../../types/Endpoints";
import smartQuery from "../../utilities/smartQuery";

export default async function (request: FastifyRequest<{ Params: { id?: string } }>): Promise<[number, any]> {
	const connection = await getMariaConnection();
	if (!connection) {
		return [500, { error: "Failed to connect to the database" }];
	}

	try {
		const query = request.params?.id
			? "SELECT il.*, u.name AS username, u.displayName FROM item_listings il LEFT JOIN users u ON il.seller_id = u.user_id WHERE il.item_id = ? AND (il.expires_at > NOW() OR il.expires_at IS NULL);"
			: "SELECT il.*, u.name AS username, u.displayName FROM item_listings il LEFT JOIN users u ON il.seller_id = u.user_id WHERE il.expires_at > NOW() OR il.expires_at IS NULL;";

		const listings = await smartQuery<ItemListing[]>(
			connection,
			query,
			request.params?.id ? [request.params.id] : [],
		);

		return [200, { status: "OK", listings }];
	} catch (error) {
		console.error("Error fetching items:", error);
		return [500, { error: "Internal Server Error" }];
	} finally {
		await connection.release();
	}
}
