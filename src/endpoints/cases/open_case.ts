import { FastifyRequest } from "fastify";
import { getMariaConnection } from "../../service/mariadb";
import getRandomWeightedEntry, { Entry } from "../../utilities/getRandomWeightedEntry";
import smartQuery from "../../utilities/smartQuery";
import { ItemCase } from "../../types/Endpoints";

export default async function (
	request: FastifyRequest<{ Params: { id: string }; Body: { user_id?: string } }>,
): Promise<[number, any]> {
	const connection = await getMariaConnection();
	if (!connection) {
		return [500, { error: "Failed to connect to the database" }];
	}

	try {
		const user_id = request.body.user_id;
		if (!user_id || isNaN(parseInt(user_id))) {
			return [400, { error: "Invalid user_id" }];
		}

		const id = request.params.id;
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

		const entry = getRandomWeightedEntry(item_case.items);
		const item_id = entry.id;

		await connection.beginTransaction();
		await connection.query("UPDATE items SET total_unboxed = total_unboxed + 1 WHERE id = ?", [item_id]);
		await connection.query("INSERT INTO item_copies (item_id, owner_id) VALUES (?, ?)", [item_id, user_id]);
		await connection.commit();

		return [
			200,
			{
				status: "OK",
				result: entry,
			},
		];
	} catch (error) {
		console.error(error);
		await connection.rollback();
		return [500, { error: "Internal server error" }];
	} finally {
		connection.release();
	}
}
