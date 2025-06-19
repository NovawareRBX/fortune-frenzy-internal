import { FastifyRequest } from "fastify";
import { getPostgresConnection } from "../../service/postgres";
import { z } from "zod";

const confirmParamsSchema = z.object({
	transfer_id: z.string(),
});

const confirmBodySchema = z.object({
	user_id: z.string().regex(/^\d+$/),
}).partial(); // body may be empty if swap=true

const confirmQuerySchema = z.object({
	swap: z.coerce.boolean().optional(),
});

export default {
	method: "POST",
	url: "/items/item-transfer/:transfer_id/confirm",
	authType: "key",
	callback: async function (
		request: FastifyRequest<{
			Body?: {
				user_id: string;
			};
			Params: {
				transfer_id: string;
			};
			Querystring: {
				swap?: boolean;
			};
		}>,
	): Promise<[number, any]> {
		const connection = await getPostgresConnection();
		if (!connection) {
			return [500, { error: "Failed to connect to the database" }];
		}

		try {
			const paramsParse = confirmParamsSchema.safeParse(request.params);
			const queryParse = confirmQuerySchema.safeParse(request.query);
			const bodyParse = request.body ? confirmBodySchema.safeParse(request.body) : { success: true, data: {} } as any;

			if (!paramsParse.success || !queryParse.success || (!queryParse.data.swap && !bodyParse.success)) {
				return [400, { error: "Invalid request", errors: {
					params: !paramsParse.success ? paramsParse.error.flatten() : undefined,
					query: !queryParse.success ? queryParse.error.flatten() : undefined,
					body: !bodyParse.success ? (bodyParse.success ? undefined : bodyParse.error.flatten()) : undefined,
				}}];
			}

			const { transfer_id } = paramsParse.data;
			const { swap } = queryParse.data;
			const user_id = bodyParse.success && bodyParse.data.user_id;

			await connection.query("BEGIN");

			const { rows: transferRows } = await connection.query("SELECT * FROM item_transfers WHERE transfer_id = $1", [transfer_id]);
			const transfer = transferRows[0];

			if (!transfer) {
				await connection.query("ROLLBACK");
				return [404, { error: "Transfer not found" }];
			}

			const { rows: items } = await connection.query<{
				id: number;
				transfer_id: string;
				user_id: string;
				item_uaid: string;
			}>("SELECT * FROM item_transfer_items WHERE transfer_id = $1", [transfer_id]);

			if (items.length === 0) {
				await connection.query("DELETE FROM item_transfers WHERE transfer_id = $1", [transfer_id]);
				await connection.query("COMMIT");
				return [404, { error: "No items in transfer" }];
			}

			const userasset_pairs = items.map((item) => [item.user_id, item.item_uaid]);
			const pairPlaceholders = userasset_pairs.map((_, idx) => `($${idx * 2 + 1}, $${idx * 2 + 2})`).join(", ");
			const owned_items_query = `SELECT owner_id, user_asset_id FROM item_copies WHERE (owner_id, user_asset_id) IN (${pairPlaceholders}) FOR UPDATE NOWAIT`;
			const { rows: owned_items } = await connection.query<{ owner_id: string; user_asset_id: string }>(owned_items_query, userasset_pairs.flat());

			const owned_set = new Set(owned_items.map((oi) => `${oi.owner_id}_${oi.user_asset_id}`));
			for (const item of items) {
				if (!owned_set.has(`${item.user_id}_${item.item_uaid}`)) {
					await connection.query("DELETE FROM item_transfers WHERE transfer_id = $1", [transfer_id]);
					await connection.query("COMMIT");
					return [403, { error: "Item not owned by user" }];
				}
			}

			if (!swap) {
				const uaidPlaceholders = items.map((_, idx) => `$${idx + 2}`).join(", ");
				await connection.query(
					`UPDATE item_copies SET owner_id = $1 WHERE user_asset_id IN (${uaidPlaceholders})`,
					[user_id, ...items.map((item) => item.item_uaid)],
				);
			} else {
				const distinct_owners = Array.from(new Set(items.map((it) => it.user_id)));
				if (distinct_owners.length !== 2) {
					await connection.query("ROLLBACK");
					return [400, { error: "Swap requires exactly two distinct users in the transfer" }];
				}

				const [owner_a, owner_b] = distinct_owners;
				const owner_a_items = items.filter((i) => i.user_id === owner_a).map((i) => i.item_uaid);
				const owner_b_items = items.filter((i) => i.user_id === owner_b).map((i) => i.item_uaid);

				if (owner_a_items.length > 0) {
					const ownerAPlaceholders = owner_a_items.map((_, idx) => `$${idx + 2}`).join(", ");
					await connection.query(
						`UPDATE item_copies SET owner_id = $1 WHERE user_asset_id IN (${ownerAPlaceholders})`,
						[owner_b, ...owner_a_items],
					);
				}
				if (owner_b_items.length > 0) {
					const ownerBPlaceholders = owner_b_items.map((_, idx) => `$${idx + 2}`).join(", ");
					await connection.query(
						`UPDATE item_copies SET owner_id = $1 WHERE user_asset_id IN (${ownerBPlaceholders})`,
						[owner_a, ...owner_b_items],
					);
				}
			}

			await connection.query("UPDATE item_transfers SET status = 'confirmed' WHERE transfer_id = $1", [transfer_id]);

			await connection.query("COMMIT");
			return [200, { status: "OK" }];
		} catch (error) {
			console.log(error)
			await connection.query("ROLLBACK");
			return [500, { error: "Failed to create transfer" }];
		} finally {
			connection.release();
		}
	}
};
