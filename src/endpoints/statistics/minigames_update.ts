import { FastifyRequest } from "fastify";
import { getRedisConnection } from "../../service/redis";

export default async function (
	request: FastifyRequest<{
		Params: { name: string };
		Body: {
			current_ccu: number;
			total_spent: number;
			total_games_played: number;
			total_wins?: number;
			total_losses?: number;
		};
	}>,
): Promise<[number, any]> {
	const redis = await getRedisConnection();

	if (!redis) {
		return [500, { error: "Failed to connect to the database" }];
	}

	try {
		const { current_ccu, total_spent, total_games_played, total_wins, total_losses } = request.body;
		const { name } = request.params;

		await Promise.all([
			redis.incrBy(`minigame_stats:${name}:current_ccu`, current_ccu),
			redis.incrBy(`minigame_stats:${name}:total_spent`, total_spent),
			redis.incrBy(`minigame_stats:${name}:total_games_played`, total_games_played),
			total_wins && redis.incrBy(`minigame_stats:${name}:total_wins`, total_wins),
			total_losses && redis.incrBy(`minigame_stats:${name}:total_losses`, total_losses),
		]);

		const minigameKeys = await redis.keys("minigame_stats:*:current_ccu");
		const minigameNames = minigameKeys.map((key) => key.split(":")[1]);

		const stats: Record<string, any> = {};
		await Promise.all(
			minigameNames.map(async (gameName) => {
				const [currentCcu, totalSpent, totalGamesPlayed, totalWins, totalLosses] = await Promise.all([
					redis.get(`minigame_stats:${gameName}:current_ccu`) || "0",
					redis.get(`minigame_stats:${gameName}:total_spent`) || "0",
					redis.get(`minigame_stats:${gameName}:total_games_played`) || "0",
					redis.get(`minigame_stats:${gameName}:total_wins`) || "0",
					redis.get(`minigame_stats:${gameName}:total_losses`) || "0",
				]);

				stats[gameName] = {
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
		return [500, { error: "Failed to update statistics" }];
	}
}
