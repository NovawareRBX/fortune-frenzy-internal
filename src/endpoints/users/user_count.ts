import { FastifyRequest } from "fastify";
import { getPostgresConnection } from "../../service/postgres";
import { getRedisConnection } from "../../service/redis";

export default {
	method: "GET",
	url: "/users/total",
	authType: "none",
	callback: async function (request: FastifyRequest): Promise<[number, any]> {
		const connection = await getPostgresConnection();
		const redis = await getRedisConnection();

		if (!connection || !redis) {
			return [500, { error: "Failed to connect to the database" }];
		}

		try {
			const cachedCount = await redis.get("total_user_count");
			if (cachedCount) {
				return [200, { count: cachedCount }];
			}

			const { rows } = await connection.query("SELECT COUNT(*) as count FROM users");
			const count = parseInt(rows[0].count, 10);
			await redis.set("total_user_count", count, { EX: 300 });

			return [200, { count }];
		} catch (error) {
			console.error(error);
			return [500, { error: "Failed to get user count" }];
		} finally {
			connection.release();
		}
	}
};
