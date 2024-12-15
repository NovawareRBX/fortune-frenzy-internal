import { FastifyRequest } from "fastify";
import { getMariaConnection } from "../../service/mariadb";
import query from "../../utilities/smartQuery";
import { randomBytes } from "crypto";

export default async function (
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
		if (!request.body || !Array.isArray(request.body) || request.body.length === 0) {
			return [400, { error: "Invalid request" }];
		}

		for (const entry of request.body) {
			if (!entry.user_id || !entry.items || !Array.isArray(entry.items) || entry.items.length === 0) {
				return [400, { error: "Invalid request" }];
			}
			if (
				typeof entry.user_id !== "string" ||
				!entry.items.every((item) => typeof item === "string" && item.startsWith("FF"))
			) {
				return [400, { error: "Invalid request" }];
			}
		}

		const transfer_id = randomBytes(10).toString("base64").replace(/[+/=]/g, "").substring(0, 10);
		const items = request.body.map((entry) => entry.items.map((item) => [transfer_id, entry.user_id, item])).flat();
		if (items.length === 0) {
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
}
