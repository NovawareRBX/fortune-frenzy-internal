import { FastifyRequest } from "fastify";
import { getMariaConnection } from "../../service/mariadb";

export default async function (request: FastifyRequest<{ Params?: { id: string } }>): Promise<[number, any]> {
	const connection = await getMariaConnection();
	if (!connection) {
		return [500, { error: "Failed to connect to the database" }];
	}

	try {
		if (!request.params || !request.params.id) {
			const rows = await connection.query(
				"SELECT * FROM item_listings WHERE expires_at > NOW() OR expires_at IS NULL;",
			);

			const result = rows.map((row: any) => {
				Object.keys(row).forEach((key) => typeof row[key] === "bigint" && (row[key] = row[key].toString()));
				return row;
			});

			return [200, { status: "OK", listings: result }];
		}

		if (isNaN(parseInt(request.params.id))) {
			return [400, { error: "Invalid item id" }];
		}

		const rows = await connection.query(
			"SELECT * FROM item_listings WHERE item_id = ? AND (expires_at > NOW() OR expires_at IS NULL);",
			[request.params.id],
		);
        const result = rows.map((row: any) => {
			Object.keys(row).forEach((key) => typeof row[key] === "bigint" && (row[key] = row[key].toString()));
			return row;
		});

		return [200, { status: "OK", listings: result }];
	} catch (error) {
		console.error("Error fetching items:", error);
		return [500, { error: "Internal Server Error" }];
	} finally {
		await connection.release();
	}
}
