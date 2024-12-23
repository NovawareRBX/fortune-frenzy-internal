import { PoolConnection } from "mariadb";
import { getRedisConnection } from "../service/redis";
import query from "./smartQuery";

export default async function (connection: PoolConnection, uaids: string[]): Promise<string[]> {
	const redis = await getRedisConnection();

	const cached_results = await redis.mGet(uaids.map((id) => `itemCopy:${id}`));
	const results: string[] = [];
	const uncached_uaids: string[] = [];

	uaids.forEach((uaid, index) => {
		if (cached_results[index]) {
			results.push(cached_results[index]);
		} else {
			uncached_uaids.push(uaid);
		}
	});

	if (uncached_uaids.length > 0) {
		const items = await query<Array<{ item_id: string; user_asset_id: string }>>(
			connection,
			`SELECT item_id, user_asset_id FROM item_copies WHERE user_asset_id IN (?)`,
			[uncached_uaids],
		);

		const redis_multi = redis.multi();
		items.forEach((item) => {
			const value = `${item.user_asset_id}:${item.item_id}`;
			results.push(value);
			redis_multi.set(`itemCopy:${item.user_asset_id}`, value, { EX: 600 });
		});

		await redis_multi.exec();
	}

	return results;
}
