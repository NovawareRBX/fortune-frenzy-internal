import { FastifyRequest } from "fastify";
import { getMariaConnection } from "../../service/mariadb";
import { ItemListing } from "../../types/Endpoints";

function convertBigIntToString(obj: Record<string, any>): Record<string, any> {
	Object.keys(obj).forEach((key) => {
		if (typeof obj[key] === "bigint") {
			obj[key] = obj[key].toString();
		}
	});
	return obj;
}

export default async function (request: FastifyRequest<{ Params: { id?: string } }>): Promise<[number, any]> {
	const connection = await getMariaConnection();
	if (!connection) {
		return [500, { error: "Failed to connect to the database" }];
	}

	try {
		const query = request.params?.id
			? "SELECT il.*, u.name AS username, u.displayName FROM item_listings il LEFT JOIN users u ON il.seller_id = u.user_id WHERE il.item_id = ? AND (il.expires_at > NOW() OR il.expires_at IS NULL);"
			: "SELECT il.*, u.name AS username, u.displayName FROM item_listings il LEFT JOIN users u ON il.seller_id = u.user_id WHERE il.expires_at > NOW() OR il.expires_at IS NULL;";

		const rows = await connection.query(query, request.params?.id ? [request.params.id] : []);
		const listings: ItemListing[] = rows.map((row: any) => convertBigIntToString(row));

		return [200, { status: "OK", listings }];
	} catch (error) {
		console.error("Error fetching items:", error);
		return [500, { error: "Internal Server Error" }];
	} finally {
		await connection.release();
	}
}
