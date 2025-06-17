import { FastifyRequest } from "fastify";
import { getMariaConnection } from "../../service/mariadb";
import query from "../../utilities/smartQuery";
import { randomBytes } from "crypto";
import { z } from "zod";

const transferItemSchema = z.object({
	user_id: z.string().regex(/^\d+$/),
	items: z.array(z.string().regex(/^FF/)).min(1),
});

const transferBodySchema = z.array(transferItemSchema).min(1);

export default {
	method: "POST",
	url: "/items/item-transfer",
	authType: "key",
	callback: async function (
		request: FastifyRequest<{
			Body: Array<{
				user_id: string;
				items: string[];
			}>;
		}>,
	): Promise<[number, any]> {
		const connection = await getMariaConnection();
		if (!connection) {
			return [500, { error: "Failed to connect to the database" }];
		}

		try {
			const parseResult = transferBodySchema.safeParse(request.body);
			if (!parseResult.success) {
				return [400, { error: "Invalid request", errors: parseResult.error.flatten() }];
			}

			const validBody = parseResult.data;

			const transfer_id = randomBytes(10).toString("base64").replace(/[+/=]/g, "").substring(0, 10);
			const items = validBody
				.map((entry) => entry.items.map((item) => [transfer_id, entry.user_id, item]))
				.flat();
			if (items.length === 0) {
				return [400, { error: "Invalid request" }];
			}

			const data = await query(
				connection,
				`SELECT user_asset_id, owner_id FROM item_copies WHERE (user_asset_id, owner_id) IN (${items
					.map(() => "(?, ?)")
					.join(", ")})`,
				items.flatMap((item) => [item[2], item[1]]),
			);

			if (data.length !== items.length) {
				return [400, { error: "Invalid request" }];
			}

			await query(connection, "INSERT INTO item_transfers (transfer_id) VALUES (?)", [transfer_id]);
			const placeholders = items.map(() => "(?, ?, ?)").join(", ");
			const values = items.flat();

			await query(
				connection,
				`INSERT INTO item_transfer_items (transfer_id, user_id, item_uaid) VALUES ${placeholders}`,
				values,
			);

			return [200, { status: "OK", transfer_id }];
		} catch (error) {
			console.error("item_transfer", error);
			return [500, { error: "Failed to create transfer" }];
		} finally {
			connection.release();
		}
	},
};
