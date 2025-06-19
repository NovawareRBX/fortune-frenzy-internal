import { FastifyRequest } from "fastify";
import { getRedisConnection } from "../../service/redis";
import { getPostgresConnection } from "../../service/postgres";
import { CoinflipRedisManager } from "../../service/coinflip-redis";
import { z } from "zod";

const cancelParamsSchema = z.object({
	coinflip_id: z.string(),
});

export default {
	method: "POST",
	url: "/coinflip/cancel/:coinflip_id",
	authType: "key",
	callback: async function (
		request: FastifyRequest<{
			Params: { coinflip_id: string };
		}>,
	): Promise<[number, any]> {
		const paramsParse = cancelParamsSchema.safeParse(request.params);
		if (!paramsParse.success) {
			return [400, { error: "Invalid request", errors: paramsParse.error.flatten() }];
		}
		const { coinflip_id } = paramsParse.data;

		const redis = await getRedisConnection();
		const connection = await getPostgresConnection();

		if (!connection || !redis) {
			return [500, { error: "Failed to connect to the database" }];
		}

		const coinflipManager = new CoinflipRedisManager(redis, request.server);

		try {
			const coinflip = await coinflipManager.getCoinflip(coinflip_id);
			if (!coinflip) {
				return [404, { error: "Coinflip not found" }];
			}

			if (coinflip.status !== "waiting_for_player") {
				return [400, { error: "Coinflip cannot be canceled" }];
			}

			const success = await coinflipManager.cancelCoinflip(coinflip_id, coinflip);
			if (!success) {
				return [500, { error: "Failed to cancel coinflip" }];
			}

			return [200, { status: "OK", message: "Coinflip canceled successfully" }];
		} catch (error) {
			return [500, { error: "Failed to cancel coinflip" }];
		} finally {
			connection.release();
		}
	},
};
