import { FastifyRequest } from "fastify";
import { getMariaConnection } from "../../service/mariadb";
import { ItemListing } from "../../types/Endpoints";
import smartQuery from "../../utilities/smartQuery";

export default async function (
	request: FastifyRequest<{ Params: { uaid: string }; Body: { buyer_id?: string } }>,
): Promise<[number, any]> {
	const connection = await getMariaConnection();
	if (!connection) {
		return [500, { error: "Failed to connect to the database" }];
	}

	try {
		const body = request.body;
		const { uaid } = request.params;

		if (!body) {
			return [400, { error: "Missing body" }];
		}

		const buyerId = Number(body.buyer_id);

		if (!buyerId || isNaN(buyerId)) {
			return [400, { error: "Invalid buyer_id" }];
		}

		await connection.beginTransaction();
		const [listing] = await smartQuery<ItemListing[]>(
			connection,
			"SELECT * FROM item_listings WHERE user_asset_id = ? FOR UPDATE",
			[uaid],
		);

		if (!listing) {
			await connection.rollback();
			return [404, { error: "Listing not found" }];
		}

		if (listing.expires_at && new Date(listing.expires_at) < new Date()) {
			await connection.rollback();
			return [400, { error: "Listing has expired" }];
		}

		await connection.query("UPDATE item_copies SET owner_id = ? WHERE user_asset_id = ?", [buyerId, uaid]);
		await connection.query("DELETE FROM item_listings WHERE user_asset_id = ?", [uaid]);
		await connection.query(
			"INSERT INTO external_cash_change_requests (user_id, amount, status) VALUES (?, ?, 'pending')",
			[listing.seller_id, Number(listing.price) * 0.7],
		);

		await connection.commit();
		return [200, { success: true }];
	} catch (error) {
		await connection.rollback();
		return [500, { status: "ERROR" }];
	} finally {
		connection.release();
	}
}
