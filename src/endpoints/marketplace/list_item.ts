import { FastifyRequest } from "fastify";
import { getPostgresConnection } from "../../service/postgres";
import { z } from "zod";
import getUaidInfo from "../../utilities/getUaidInfo";

const listParamsSchema = z.object({
	uaid: z.string(),
});

const listBodySchema = z.object({
	price: z.number().positive().optional(),
	expiry: z.number().optional(),
})

export default {
	method: "POST",
	url: "/marketplace/copies/:uaid/list",
	authType: "key",
	callback: async function (
		request: FastifyRequest<{ Params: { uaid: string }; Body: unknown }>,
	): Promise<[number, any]> {
		const connection = await getPostgresConnection();
		if (!connection) {
			return [500, { error: "Failed to connect to the database" }];
		}

		try {
			const paramsParse = listParamsSchema.safeParse(request.params);
			const rawBody = (request.body && typeof request.body === "object" && !Array.isArray(request.body)) ? request.body : {};
			const bodyParse = listBodySchema.safeParse(rawBody);
			if (!paramsParse.success || !bodyParse.success) {
				return [400, { error: "Invalid request", errors: {
					params: !paramsParse.success ? paramsParse.error.flatten() : undefined,
					body: !bodyParse.success ? bodyParse.error.flatten() : undefined,
				}}];
			}
			const { uaid: user_asset_id } = paramsParse.data;
			const { price, expiry } = bodyParse.data;

			if (price === undefined) {
				const result = await connection.query(
					"DELETE FROM item_listings WHERE user_asset_id = $1",
					[user_asset_id],
				);

				if (result.rowCount === 0) {
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

			const { owner_id, item_id } = (await getUaidInfo(connection, [user_asset_id]))[0];

			await connection.query(
				`INSERT INTO item_listings (seller_id, user_asset_id, currency, expires_at, price, item_id)
				 VALUES ($1, $2, 'cash', $3, $4, $5)
				 ON CONFLICT (user_asset_id) DO UPDATE SET price = EXCLUDED.price, expires_at = EXCLUDED.expires_at`,
				[owner_id, user_asset_id, expiryTimestamp, price, item_id],
			);

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
