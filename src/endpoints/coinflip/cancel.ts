import { FastifyRequest } from "fastify";
import { getRedisConnection } from "../../service/redis";
import { getMariaConnection } from "../../service/mariadb";
import { CoinflipRedisManager } from "../../service/coinflip-redis";

export default {
	method: "POST",
	url: "/coinflip/cancel/:coinflip_id",
	authType: "key",
	callback: async function (
		request: FastifyRequest<{
			Params: { coinflip_id: string };
		}>,
	): Promise<[number, any]> {
		const { coinflip_id } = request.params;

		if (!coinflip_id || typeof coinflip_id !== "string" || coinflip_id.length < 1) {
			return [400, { error: "Invalid request" }];
		}

		const redis = await getRedisConnection();
		const connection = await getMariaConnection();

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
