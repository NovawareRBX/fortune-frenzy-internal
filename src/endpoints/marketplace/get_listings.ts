import { FastifyRequest } from "fastify";
import { getMariaConnection } from "../../service/mariadb";
import { ItemListing } from "../../types/Endpoints";
import smartQuery from "../../utilities/smartQuery";
import getUserInfo from "../../utilities/getUserInfo";

export default {
	method: "GET",
	url: "/marketplace/items/:id/listings",
	authType: "none",
	callback: async function (request: FastifyRequest<{ Params: { id: string } }>): Promise<[number, any]> {
		const connection = await getMariaConnection();
		if (!connection) {
			return [500, { error: "Failed to connect to the database" }];
		}

		try {
			const query =
				request.params.id === "all"
					? "SELECT * FROM item_listings WHERE expires_at > NOW() OR expires_at IS NULL;"
					: "SELECT * FROM item_listings WHERE item_id = ? AND (expires_at > NOW() OR expires_at IS NULL);";

			const listings = await smartQuery<ItemListing[]>(
				connection,
				query,
				request.params.id === "all" ? [] : [request.params.id],
			);

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
