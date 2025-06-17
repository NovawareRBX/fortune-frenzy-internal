import { FastifyRequest } from "fastify";
import { getMariaConnection } from "../../service/mariadb";
import getRandomWeightedEntry, { Entry } from "../../utilities/getRandomWeightedEntry";
import smartQuery from "../../utilities/smartQuery";
import { ItemCase } from "../../types/Endpoints";
import { z } from "zod";

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
		const connection = await getMariaConnection();
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

			const [item_case] = await smartQuery<ItemCase[]>(connection, "SELECT * FROM cases WHERE id = ?", [id]);

			if (!item_case) {
				return [404, { error: "Case not found" }];
			}

			item_case.items =
				typeof item_case.items === "string" ? (JSON.parse(item_case.items) as Entry[]) : item_case.items;
			item_case.ui_data = typeof item_case.ui_data === "string" ? JSON.parse(item_case.ui_data) : item_case.ui_data;

			const [user] = await smartQuery(connection, "SELECT * FROM users WHERE user_id = ?", [user_id]);
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
			const item_id = entry.id;

			await connection.beginTransaction();
			await connection.query("UPDATE items SET total_unboxed = total_unboxed + 1 WHERE id = ?", [item_id]);
			await connection.query("INSERT INTO item_copies (item_id, owner_id) VALUES (?, ?)", [item_id, user_id]);

			const targetItem = item_case.items.find((item) => item.id === item_id);
			if (targetItem) {
				targetItem.claimed += 1;
			}
			const updatedItemsJSON = JSON.stringify(item_case.items);
			await connection.query("UPDATE cases SET items = ?, opened_count = opened_count + 1 WHERE id = ?", [
				updatedItemsJSON,
				id,
			]);

			await connection.commit();

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
			await connection.rollback();
			return [500, { error: "Internal server error" }];
		} finally {
			connection.release();
		}
	}
};
