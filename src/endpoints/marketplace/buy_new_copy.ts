import { FastifyRequest } from "fastify";
import { getMariaConnection } from "../../service/mariadb";
import { ItemListing } from "../../types/Endpoints";

interface Body {
	buyer_id: string;
}

export default async function (request: FastifyRequest<{ Params: { id: string } }>): Promise<[number, any]> {
	const connection = await getMariaConnection();
	if (!connection) {
		return [500, { error: "Failed to connect to the database" }];
	}

	const body = request.body as Body;
	const { id } = request.params;

	if (!body) {
		return [400, { error: "Missing body" }];
	}

	const buyerId = Number(body.buyer_id);

	if (!buyerId || isNaN(buyerId)) {
		return [400, { error: "Invalid buyer_id" }];
	}

	try {
		const [item] = await connection.query(`SELECT * FROM items WHERE id = ?;`, [id]);

		if (!item) {
			return [404, { error: "Item not found" }];
		}

		const offsaleQuantity: number = item.offsale_quantity;
		const offsaleTime: Date = item.offsale_time;
		const totalSold: number = item.total_sold;

		if (totalSold >= offsaleQuantity || offsaleTime < new Date()) {
			return [404, { error: "Item is no longer available" }];
		}

		// perform the atomic update to ensure no overselling
		const updateResult = await connection.query(
			`
			UPDATE items 
			SET total_sold = total_sold + 1 
			WHERE id = ? AND total_sold < offsale_quantity;
			`,
			[id],
		);

		if (updateResult.affectedRows === 0) {
			return [404, { error: "Item is no longer available" }];
		}

		const result = await connection.query(`INSERT INTO item_copies (item_id, owner_id) VALUES (?, ?);`, [
			id,
			buyerId,
		]);

		if (!result) {
			return [500, { error: "Failed to buy item" }];
		}

		const [newItem] = await connection.query(
			`
			SELECT * FROM items WHERE id = ?;
		`,
			[id],
		);
		Object.keys(newItem).forEach(
			(key) => typeof newItem[key] === "bigint" && (newItem[key] = newItem[key].toString()),
		);

		return [200, { success: true, item: newItem }];
	} catch (error) {
		console.error(error);
		return [500, { error: "Internal server error" }];
	} finally {
		connection.release();
	}
}
