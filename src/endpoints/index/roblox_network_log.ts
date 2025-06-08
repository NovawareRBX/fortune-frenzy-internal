import { FastifyRequest } from "fastify";
import { getRedisConnection } from "../../service/redis";

export default {
	method: "POST",
	url: "/logging/network",
	authType: "key",
	callback: async function (
		request: FastifyRequest<{
			Body: {
				server_id: string;
				logs: {
					network_name: string;
					speed: number;
					response: string;
					player: { name: string; id: number };
				}[];
			};
		}>,
	): Promise<[number, any]> {
		const redis = await getRedisConnection();
		redis.publish("roblox_network_log", Buffer.from(JSON.stringify(request.body)));
		return [200, { success: true }];
	}
};
