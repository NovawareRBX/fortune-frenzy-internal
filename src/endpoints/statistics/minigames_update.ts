import { FastifyRequest } from "fastify";
import { z } from "zod";
import { getRedisConnection } from "../../service/redis";

const minigameUpdateParamsSchema = z.object({
	name: z.string().min(1),
});

const minigameUpdateBodySchema = z.object({
	current_ccu: z.number().int().nonnegative(),
	total_spent: z.number(),
	total_games_played: z.number(),
	total_wins: z.number().optional(),
	total_losses: z.number().optional(),
});

export default {
	method: "POST",
	url: "/statistics/minigames/:name",
	authType: "key",
	callback: async function (
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
		// Validate request
		const paramsParse = minigameUpdateParamsSchema.safeParse(request.params);
		const bodyParse = minigameUpdateBodySchema.safeParse(request.body);
		if (!paramsParse.success || !bodyParse.success) {
			return [
				400,
				{
					error: "Invalid request",
					errors: {
						params: !paramsParse.success ? paramsParse.error.flatten() : undefined,
						body: !bodyParse.success ? bodyParse.error.flatten() : undefined,
					},
				},
			];
		}

		const { current_ccu, total_spent, total_games_played, total_wins, total_losses } = bodyParse.data;
		const { name } = paramsParse.data;

		const redis = await getRedisConnection();
		if (!redis) {
			return [500, { error: "Failed to connect to the database" }];
		}

		try {
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
	},
};
