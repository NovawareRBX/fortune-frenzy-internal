import { FastifyRequest } from "fastify";
import { getPostgresConnection } from "../../service/postgres";
import { ItemListing } from "../../types/Endpoints";
import { z } from "zod";
import doSelfHttpRequest from "../../utilities/internalRequest";

const buyParamsSchema = z.object({
	uaid: z.string(),
});

const buyBodySchema = z.object({
	buyer_id: z.string().regex(/^\d+$/),
});

export default {
	method: "POST",
	url: "/marketplace/copies/:uaid/buy",
	authType: "key",
	callback: async function (
		request: FastifyRequest<{ Params: { uaid: string }; Body: { buyer_id?: string } }>,
	): Promise<[number, any]> {
		const connection = await getPostgresConnection();
		if (!connection) return [500, { error: "Failed to connect to the database" }];

		try {
			const paramsParse = buyParamsSchema.safeParse(request.params);
			const bodyParse = buyBodySchema.safeParse(request.body);
			if (!paramsParse.success || !bodyParse.success)
				return [
					400,
					{
						error: "Invalid request",
						errors: {
							params: !paramsParse.success ? paramsParse.error.flatten() : undefined,
							body: !bodyParse.success ? bodyParse.error.flatten() : undefined,
						},
					},
				];

			const { uaid } = paramsParse.data;
			const buyerId = Number(bodyParse.data.buyer_id);

			const { rows: listingsPre } = await connection.query<ItemListing>(
				"SELECT * FROM item_listings WHERE user_asset_id = $1",
				[uaid],
			);
			const listing = listingsPre[0];

			if (!listing) return [404, { error: "Listing not found" }];
			if (listing.expires_at && new Date(listing.expires_at) < new Date())
				return [400, { error: "Listing has expired" }];

			const createTransferResp = await doSelfHttpRequest(request.server, {
				method: "POST",
				url: "/items/item-transfer",
				body: [
					{
						user_id: listing.seller_id.toString(),
						items: [uaid],
					},
				],
			});

			if (createTransferResp.statusCode !== 200) return [500, { error: "Failed to initiate item transfer" }];
			const { transfer_id } = JSON.parse(createTransferResp.body);

			const confirmTransferResp = await doSelfHttpRequest(request.server, {
				method: "POST",
				url: `/items/item-transfer/${transfer_id}/confirm`,
				body: { user_id: buyerId.toString() },
			});

			if (confirmTransferResp.statusCode !== 200) {
				if (confirmTransferResp.statusCode === 403) return [400, { error: "Item owner has changed" }];
				return [500, { error: "Failed to complete item transfer" }];
			}

			await connection.query("BEGIN");
			await connection.query("DELETE FROM item_listings WHERE user_asset_id = $1", [uaid]);

			await connection.query(
				"INSERT INTO external_cash_change_requests (user_id, amount, status) VALUES ($1, $2, 'pending') ON CONFLICT DO NOTHING",
				[listing.seller_id, Number(listing.price) * 0.7],
			);

			await connection.query("COMMIT");
			return [200, { success: true }];
		} catch (error: any) {
			await connection.query("ROLLBACK");
			if (error.code === "55P03")
				return [409, { error: "Listing is currently being purchased by another process" }];
			return [500, { error: "Unexpected server error" }];
		} finally {
			connection.release();
		}
	},
};
