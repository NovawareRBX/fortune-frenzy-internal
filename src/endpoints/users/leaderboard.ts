import { getMariaConnection } from "../../service/mariadb";
import { getRedisConnection } from "../../service/redis";
import smartQuery from "../../utilities/smartQuery";

const LEADERBOARDS_CACHE_KEY = "leaderboards";
const LEADERBOARD_CACHE_TTL = 5;

export default async function (): Promise<[number, any]> {
    try {
        const redis = await getRedisConnection();
        const cached_leaderboards = await redis.get(LEADERBOARDS_CACHE_KEY);
        if (cached_leaderboards) {
            return [
                200,
                {
                    status: "OK",
                    leaderboards: JSON.parse(cached_leaderboards),
                },
            ];
        }
    } catch (redis_error) {
        console.error("redis error:", redis_error);
    }

    const connection = await getMariaConnection();
    if (!connection) return [500, { error: "failed to connect to the database" }];
    try {
        const cash_rows = await smartQuery(
            connection,
            "SELECT user_id, name, display_name, current_cash FROM users WHERE current_cash IS NOT NULL ORDER BY current_cash DESC LIMIT 100",
        );
        const value_rows = await smartQuery(
            connection,
            "SELECT user_id, name, display_name, current_value FROM users WHERE current_value IS NOT NULL ORDER BY current_value DESC LIMIT 100",
        );

        const cash_leaderboard = cash_rows.map((row: any) => [row.user_id, row.name, row.display_name, row.current_cash]);
        const value_leaderboard = value_rows.map((row: any) => [
            row.user_id,
            row.name,
            row.display_name,
            row.current_value,
        ]);

        const leaderboards = {
            cash: cash_leaderboard,
            value: value_leaderboard,
        };

        try {
            const redis = await getRedisConnection();
            await redis.set(LEADERBOARDS_CACHE_KEY, JSON.stringify(leaderboards), { EX: LEADERBOARD_CACHE_TTL });
        } catch (cache_error) {
            console.error("failed to cache leaderboards in redis:", cache_error);
        }

        return [
            200,
            {
                status: "OK",
                leaderboards,
            },
        ];
    } catch (error) {
        console.error("database error:", error);
        return [500, { error: "internal server error" }];
    } finally {
        await connection.release();
    }
}
