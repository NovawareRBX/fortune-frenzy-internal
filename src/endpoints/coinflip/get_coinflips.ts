import { FastifyRequest } from "fastify";
import { getRedisConnection } from "../../service/redis";
import { CoinflipRedisManager } from "../../service/coinflip-redis";

export default {
	method: "GET",
	url: "/coinflips",
	authType: "none",
	callback: async function (
		request: FastifyRequest<{
			Querystring: { server_id?: string };
		}>,
	): Promise<[number, any]> {
		try {
			const redis = await getRedisConnection();
			if (!redis) {
				return [500, { error: "Failed to connect to Redis" }];
			}

			const { server_id } = request.query;
			const coinflipManager = new CoinflipRedisManager(redis, request.server);

			const coinflipIds = await coinflipManager.getActiveCoinflips(server_id);
			if (!coinflipIds || coinflipIds.length === 0) {
				return [200, { status: "OK", coinflips: [] }];
			}

			const coinflips = await Promise.all(
				coinflipIds.map(id => coinflipManager.getCoinflip(id))
			);

			const filteredCoinflips = coinflips
				.filter(cf => cf !== null)
				.filter(cf => {
					if (cf!.type === "global") return true;
					if (cf!.type === "server" && cf!.server_id === server_id) return true;
					return false;
				});

			return [200, { status: "OK", coinflips: filteredCoinflips }];
		} catch (error) {
			return [500, { error: "Failed to get coinflips" }];
		}
	}
};
