import { FastifyRequest } from "fastify";
import { getRedisConnection } from "../../service/redis";

export default async function (request: FastifyRequest): Promise<[number, any]> {
	const redis = await getRedisConnection();

	if (!redis) {
		return [500, { error: "Failed to connect to the database" }];
	}

	try {
		// Get all keys matching minigame_stats:*:current_ccu to find all minigames
		const minigameKeys = await redis.keys("minigame_stats:*:current_ccu");
		const minigameNames = minigameKeys.map((key) => key.split(":")[1]);

		const stats: Record<string, any> = {};

		// Fetch stats for each minigame
		await Promise.all(
			minigameNames.map(async (name) => {
				const [currentCcu, totalSpent, totalGamesPlayed, totalWins, totalLosses] = await Promise.all([
					redis.get(`minigame_stats:${name}:current_ccu`) || "0",
					redis.get(`minigame_stats:${name}:total_spent`) || "0",
					redis.get(`minigame_stats:${name}:total_games_played`) || "0",
					redis.get(`minigame_stats:${name}:total_wins`) || "0",
					redis.get(`minigame_stats:${name}:total_losses`) || "0",
				]);

				stats[name] = {
					current_ccu: Number(currentCcu),
					total_spent: Number(totalSpent),
					total_games_played: Number(totalGamesPlayed),
					total_wins: Number(totalWins),
					total_losses: Number(totalLosses),
				};
			}),
		);

		return [
			200,
			{
				status: "OK",
				stats,
			},
		];
	} catch (error) {
		console.error(error);
		return [500, { error: "Failed to fetch statistics" }];
	}
}
