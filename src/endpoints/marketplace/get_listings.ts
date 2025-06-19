import { FastifyRequest } from "fastify";
import { getPostgresConnection } from "../../service/postgres";
import { ItemListing } from "../../types/Endpoints";
import getUserInfo from "../../utilities/getUserInfo";
import { z } from "zod";

const listingsParamsSchema = z.object({
	id: z.string(),
});

export default {
	method: "GET",
	url: "/marketplace/items/:id/listings",
	authType: "none",
	callback: async function (request: FastifyRequest<{ Params: { id: string } }>): Promise<[number, any]> {
		const connection = await getPostgresConnection();
		if (!connection) {
			return [500, { error: "Failed to connect to the database" }];
		}

		try {
			const paramsParse = listingsParamsSchema.safeParse(request.params);
			if (!paramsParse.success) {
				return [400, { error: "Invalid request", errors: paramsParse.error.flatten() }];
			}

			const { id } = paramsParse.data;
			const sql =
				id === "all"
					? "SELECT * FROM item_listings WHERE expires_at > NOW() OR expires_at IS NULL;"
					: "SELECT * FROM item_listings WHERE item_id = $1 AND (expires_at > NOW() OR expires_at IS NULL);";

			const { rows: listings } = await connection.query<ItemListing>(sql, id === "all" ? [] : [id]);

			if (listings.length === 0) return [200, { status: "OK", listings: [] }];

			const userInfos = await getUserInfo(connection, [...new Set(listings.map((listing) => listing.seller_id))]);
			const userInfoMap = new Map();
			userInfos.forEach((user) => {
				userInfoMap.set(user.id, user);
			});

			const listingsWithUserInfo = listings.map((listing) => {
				const userInfo = userInfoMap.get(listing.seller_id);
				return {
					...listing,
					username: userInfo?.username || "Unknown Username",
					display_name: userInfo?.display_name || "Unknown Disp. Name",
				};
			});

			return [200, { status: "OK", listings: listingsWithUserInfo }];
		} catch (error) {
			console.error("Error fetching items:", error);
			return [500, { error: "Internal Server Error" }];
		} finally {
			await connection.release();
		}
	},
};
