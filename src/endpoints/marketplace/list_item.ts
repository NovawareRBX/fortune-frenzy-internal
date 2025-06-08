import { FastifyRequest } from "fastify";
import { getMariaConnection } from "../../service/mariadb";

export default {
	method: "POST",
	url: "/marketplace/copies/:uaid/list",
	authType: "key",
	callback: async function (
		request: FastifyRequest<{ Params: { uaid: string }; Body: { price?: number; expiry?: number } }>,
	): Promise<[number, any]> {
		const connection = await getMariaConnection();
		if (!connection) {
			return [500, { error: "Failed to connect to the database" }];
		}

		try {
			const { price, expiry } = request.body;
			const user_asset_id = request.params.uaid;

			if (!user_asset_id) {
				return [400, { error: "Missing user_asset_id in parameters" }];
			}
			if (typeof user_asset_id !== "string") {
				return [400, { error: "Invalid user_asset_id, must be a string" }];
			}
			if (price === null || price === undefined) {
				const deleteQuery = `DELETE FROM item_listings WHERE user_asset_id = ?;`;
				const result = await connection.query(deleteQuery, [user_asset_id]);

				if (result.affectedRows === 0) {
					return [404, { error: `No listing found for ${user_asset_id}` }];
				}

				return [200, { status: "OK" }];
			}

			if (typeof price !== "number" || price <= 0) {
				return [400, { error: "Invalid price, must be a positive number" }];
			}

			let expiryTimestamp = null;
			if (expiry !== undefined) {
				const currentTime = Math.floor(Date.now() / 1000);
				if (typeof expiry !== "number" || expiry <= currentTime) {
					return [400, { error: "Invalid expiry, must be undefined or a future timestamp" }];
				}
				expiryTimestamp = new Date(expiry * 1000);
			}

			const query = `INSERT INTO item_listings (user_asset_id, currency, expires_at, price) 
						   VALUES (?, "cash", ?, ?)
						   ON DUPLICATE KEY UPDATE price = VALUES(price), expires_at = VALUES(expires_at);`;
			await connection.query(query, [user_asset_id, expiryTimestamp, price]);

			return [200, { status: "OK" }];
		} catch (error) {
			if (error instanceof Error && "sqlMessage" in error) {
				if ((error as any).sqlMessage === "No matching owner found for this user_asset_id") {
					return [404, { error: "user_asset_id not found" }];
				}
			}

			return [500, { error: "Internal Server Error" }];
		} finally {
			await connection.release();
		}
	}
};
