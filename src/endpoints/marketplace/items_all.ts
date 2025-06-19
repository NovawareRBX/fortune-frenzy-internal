import { getPostgresConnection } from "../../service/postgres";
import { getRedisConnection } from "../../service/redis";

export default {
	method: "GET",
	url: "/marketplace/items",
	authType: "none",
	callback: async function(): Promise<[number, any]> {
		const connection = await getPostgresConnection();
		if (!connection) {
			return [500, { error: "Failed to connect to the database" }];
		}

		try {
			const redis = await getRedisConnection();
			const cached = await redis.get("items:all");
			if (cached) {
				return [200, { status: "OK", data: JSON.parse(cached) }];
			}

			const { rows } = await connection.query("SELECT * FROM items");
			await redis.set("items:all", JSON.stringify(rows), { EX: 300 }); // cache 5 minutes
			return [200, { status: "OK", data: rows }];
		} catch (error) {
			console.error("Error fetching items:", error);
			return [500, { error: "Internal Server Error" }];
		} finally {
			await connection.release();
		}
	}
};
