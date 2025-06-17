import { FastifyRequest } from "fastify";
import { getMariaConnection } from "../../service/mariadb";
import { z } from "zod";

const listParamsSchema = z.object({
	uaid: z.string(),
});

const listBodySchema = z.object({
	price: z.number().positive().optional(),
	expiry: z.number().optional(),
});

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
			const paramsParse = listParamsSchema.safeParse(request.params);
			const bodyParse = listBodySchema.safeParse(request.body);
			if (!paramsParse.success || !bodyParse.success) {
				return [400, { error: "Invalid request", errors: {
					params: !paramsParse.success ? paramsParse.error.flatten() : undefined,
					body: !bodyParse.success ? bodyParse.error.flatten() : undefined,
				}}];
			}
			const { uaid: user_asset_id } = paramsParse.data;
			const { price, expiry } = bodyParse.data;

			if (price === undefined) {
				const deleteQuery = `DELETE FROM item_listings WHERE user_asset_id = ?;`;
				const result = await connection.query(deleteQuery, [user_asset_id]);

				if (result.affectedRows === 0) {
					return [404, { error: `No listing found for ${user_asset_id}` }];
				}

				return [200, { status: "OK" }];
			}

			let expiryTimestamp: Date | null = null;
			if (expiry !== undefined) {
				const currentTime = Math.floor(Date.now() / 1000);
				if (expiry <= currentTime) {
					return [400, { error: "Invalid expiry, must be a future timestamp" }];
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
