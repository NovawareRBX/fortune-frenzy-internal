import { PoolConnection } from "mariadb";
import { getRedisConnection } from "../service/redis";
import query from "./smartQuery";

export default async function getUserInfo(
	connection: PoolConnection,
	userIds: string[],
): Promise<Array<{ id: string; username: string; display_name: string }>> {
	const redis = await getRedisConnection();
	const cached_results = await redis.mGet(userIds.map((id) => `userInfo:${id}`));
	const results: Array<{ id: string; username: string; display_name: string }> = [];
	const uncached_user_ids: string[] = [];

	userIds.forEach((userId, index) => {
		if (cached_results[index]) {
			const [username, display_name] = cached_results[index].split(":");
			results.push({ id: userId, username, display_name });
		} else {
			uncached_user_ids.push(userId);
		}
	});

	if (uncached_user_ids.length > 0) {
		const users = await query<Array<{ user_id: string; name: string; display_name: string }>>(
			connection,
			"SELECT user_id, name, display_name FROM users WHERE user_id IN (?)",
			[uncached_user_ids],
		);

		const redis_multi = redis.multi();
		users.forEach((user) => {
			const value = `${user.name}:${user.display_name}`;
			results.push({ id: user.user_id, username: user.name, display_name: user.display_name });
			redis_multi.set(`userInfo:${user.user_id}`, value, { EX: 600 }); // Cache for 10 minutes
		});

		await redis_multi.exec();

		const missing_users = uncached_user_ids.filter((id) => !users.some((user) => user.user_id === id));
		missing_users.forEach((id) => {
			results.push({ id, username: "Unknown Username", display_name: "Unknown Disp. Name" });
		});
	}

	return results;
}
