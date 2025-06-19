import { FastifyRequest } from "fastify";
import { getPostgresConnection } from "../../service/postgres";
import { z } from "zod";
import getUserInfo from "../../utilities/getUserInfo";

const ownersParamsSchema = z.object({
	id: z.string(),
});

export default {
	method: "GET",
	url: "/marketplace/items/:id/owners",
	authType: "none",
	callback: async function (request: FastifyRequest<{ Params: { id: string } }>): Promise<[number, any]> {
		const connection = await getPostgresConnection();
		if (!connection) {
			return [500, { error: "Failed to connect to the database" }];
		}

		try {
			const paramsParse = ownersParamsSchema.safeParse(request.params);
			if (!paramsParse.success) {
				return [400, { error: "Invalid request", errors: paramsParse.error.flatten() }];
			}

			const { id } = paramsParse.data;

			// Fetch all copies for the given item
			const { rows: copies } = await connection.query<{
				owner_id: string;
				user_asset_id: string;
			}>(
				"SELECT owner_id, user_asset_id FROM item_copies WHERE item_id = $1;",
				[id],
			);

			if (copies.length === 0) {
				return [200, { status: "OK", owners: [] }];
			}

			// Retrieve user information with caching via getUserInfo
			const userIds = [...new Set(copies.map((c) => c.owner_id))];
			const userInfos = await getUserInfo(connection, userIds);
			const userInfoMap = new Map(userInfos.map((u) => [u.id, u]));

			const owners = copies.map((copy) => {
				const user = userInfoMap.get(copy.owner_id);
				return {
					user_asset_id: copy.user_asset_id,
					owner_id: copy.owner_id,
					username: user?.username ?? "Unknown Username",
					display_name: user?.display_name ?? "Unknown Disp. Name",
				};
			});

			return [200, { status: "OK", owners }];
		} catch (error) {
			console.error("Error fetching item owners:", error);
			return [500, { error: "Internal Server Error" }];
		} finally {
			await connection.release();
		}
	}
};
