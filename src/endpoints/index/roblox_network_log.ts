import { FastifyRequest } from "fastify";
import { getRedisConnection } from "../../service/redis";
import { z } from "zod";

const networkLogSchema = z.object({
	server_id: z.string(),
	logs: z.array(z.object({
		network_name: z.string(),
		speed: z.number(),
		response: z.string(),
		player: z.object({ name: z.string(), id: z.number() })
	})).min(1),
});

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
		const parseResult = networkLogSchema.safeParse(request.body);
		if (!parseResult.success) {
			return [400, { error: "Invalid request", errors: parseResult.error.flatten() }];
		}
		const redis = await getRedisConnection();
		redis.publish("roblox_network_log", Buffer.from(JSON.stringify(parseResult.data)));
		return [200, { success: true }];
	}
};
