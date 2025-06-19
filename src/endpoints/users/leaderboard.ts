import { getPostgresConnection } from "../../service/postgres";
import { getRedisConnection } from "../../service/redis";

const LEADERBOARDS_CACHE_KEY = "leaderboards";
const LEADERBOARD_CACHE_TTL = 5;

export default {
    method: "GET",
    url: "/leaderboard",
    authType: "none",
    callback: async function (): Promise<[number, any]> {
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

        const connection = await getPostgresConnection();
        if (!connection) return [500, { error: "failed to connect to the database" }];
        try {
            const { rows: cash_rows } = await connection.query(
                "SELECT user_id, name, display_name, current_cash, country FROM users WHERE current_cash IS NOT NULL ORDER BY current_cash DESC LIMIT 100",
            );
            const { rows: value_rows } = await connection.query(
                "SELECT user_id, name, display_name, current_value, country FROM users WHERE current_value IS NOT NULL ORDER BY current_value DESC LIMIT 100",
            );

            const cash_leaderboard = cash_rows.map((row: any) => [row.user_id, row.name, row.display_name, row.current_cash, row.country]);
            const value_leaderboard = value_rows.map((row: any) => [
                row.user_id,
                row.name,
                row.display_name,
                row.current_value,
                row.country,
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
    },
};
