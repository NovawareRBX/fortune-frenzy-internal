import { FastifyRequest } from "fastify";
import { getRedisConnection } from "../../service/redis";
import { z } from "zod";

const serverInfoParamsSchema = z.object({
	server_id: z.string(),
});

export default {
	method: "GET",
	url: "/server/:server_id",
	authType: "none",
	callback: async function (request: FastifyRequest<{ Params: { server_id: string } }>): Promise<[number, any]> {
		const paramsParse = serverInfoParamsSchema.safeParse(request.params);
		if (!paramsParse.success) {
			return [400, { error: "Invalid request", errors: paramsParse.error.flatten() }];
		}
		const { server_id } = paramsParse.data;
		const redis = await getRedisConnection();

		const active = await redis.get(`servers:${server_id}:active`);
		const last_packet = await redis.get(`servers:${server_id}:last_packet`);

		return [200, { status: "OK", active: active === "true", last_packet }];
	}
};
