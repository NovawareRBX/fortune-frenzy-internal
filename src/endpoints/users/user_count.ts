import { FastifyReply, FastifyRequest } from "fastify";
import { getMariaConnection } from "../../service/mariadb";
import smartQuery from "../../utilities/smartQuery";
import discordLog from "../../utilities/discordLog";
import { getRedisConnection } from "../../service/redis";

export default async function (request: FastifyRequest): Promise<[number, any]> {
	const connection = await getMariaConnection();
	const redis = await getRedisConnection();

	if (!connection || !redis) {
		return [500, { error: "Failed to connect to the database" }];
	}

    try {
        const cachedCount = await redis.get("total_user_count");
        if (cachedCount) {
            return [200, { count: cachedCount }];
        }

        const [rows] = await smartQuery(connection, "SELECT COUNT(*) as count FROM users");
        const count = rows.count;
        await redis.set("total_user_count", count, { EX: 300 });

        return [200, { count }];
    } catch (error) {
        console.error(error);
        return [500, { error: "Failed to get user count" }];
    } finally {
        connection.release();
    }
}
