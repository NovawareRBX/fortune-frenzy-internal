import { FastifyRequest } from "fastify";
import { getPostgresConnection } from "../../service/postgres";
import getRandomWeightedEntry, { Entry } from "../../utilities/getRandomWeightedEntry";
import { ItemCase } from "../../types/Endpoints";
import { z } from "zod";
import { generateFreshUaid } from "../../utilities/generateFreshUaid";

const openCaseParamsSchema = z.object({
	id: z.string(),
});

const openCaseBodySchema = z.object({
	user_id: z.string().regex(/^\d+$/),
	lucky: z.boolean(),
});

export default {
	method: "POST",
	url: "/cases/open/:id",
	authType: "key",
	callback: async function (
		request: FastifyRequest<{ Params: { id: string }; Body: { user_id: string; lucky: boolean } }>,
	): Promise<[number, any]> {
		const connection = await getPostgresConnection();
		if (!connection) {
			return [500, { error: "Failed to connect to the database" }];
		}

		try {
			const paramsParse = openCaseParamsSchema.safeParse(request.params);
			const bodyParse = openCaseBodySchema.safeParse(request.body);
			if (!paramsParse.success || !bodyParse.success) {
				return [400, { error: "Invalid request", errors: {
					params: !paramsParse.success ? paramsParse.error.flatten() : undefined,
					body: !bodyParse.success ? bodyParse.error.flatten() : undefined,
				}}];
			}

			const { id } = paramsParse.data;
			const { user_id, lucky } = bodyParse.data;

			const { rows: item_cases } = await connection.query<ItemCase>("SELECT * FROM cases WHERE id = $1", [id]);
			const item_case = item_cases[0];

			if (!item_case) {
				return [404, { error: "Case not found" }];
			}

			item_case.items =
				typeof item_case.items === "string" ? (JSON.parse(item_case.items) as Entry[]) : item_case.items;
			item_case.ui_data = typeof item_case.ui_data === "string" ? JSON.parse(item_case.ui_data) : item_case.ui_data;

			const { rows: userRows } = await connection.query("SELECT * FROM users WHERE user_id = $1", [user_id]);
			const user = userRows[0];
			if (!user) {
				return [404, { error: "User not found" }];
			}

			const adjustedItems = lucky
				? (() => {
						const sortedItems = [...item_case.items].sort((a, b) => a.chance - b.chance);
						const rarestItems = sortedItems.slice(0, 3);
						const totalChance = rarestItems.reduce((sum, item) => sum + item.chance, 0);
						return rarestItems.map((item) => ({
							...item,
							chance: (item.chance / totalChance) * 100,
						}));
				  })()
				: item_case.items;

			const entry = getRandomWeightedEntry(adjustedItems);
			const uaid = await generateFreshUaid(connection);
			const item_id = entry.id;

			await connection.query("BEGIN");
			await connection.query("UPDATE items SET total_unboxed = total_unboxed + 1 WHERE id = $1", [item_id]);
			await connection.query("INSERT INTO item_copies (item_id, owner_id, user_asset_id) VALUES ($1, $2, $3)", [item_id, user_id, uaid]);

			const targetItem = item_case.items.find((item) => item.id === item_id);
			if (targetItem) {
				targetItem.claimed += 1;
			}
			const updatedItemsJSON = JSON.stringify(item_case.items);
			await connection.query("UPDATE cases SET items = $1, opened_count = opened_count + 1 WHERE id = $2", [updatedItemsJSON, id]);

			await connection.query("COMMIT");

			return [
				200,
				{
					status: "OK",
					result: entry,
					case: {
						...item_case,
						opened_count: item_case.opened_count + 1,
					},
				},
			];
		} catch (error) {
			await connection.query("ROLLBACK");
			console.error(error);
			return [500, { error: "Internal server error" }];
		} finally {
			connection.release();
		}
	}
};
