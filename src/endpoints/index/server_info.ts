import { FastifyRequest } from "fastify";
import { getRedisConnection } from "../../service/redis";

export default {
	method: "GET",
	url: "/server/:server_id",
	authType: "none",
	callback: async function (request: FastifyRequest<{ Params: { server_id: string } }>): Promise<[number, any]> {
		const server_id = request.params.server_id;
		const redis = await getRedisConnection();

		const active = await redis.get(`servers:${server_id}:active`);
		const last_packet = await redis.get(`servers:${server_id}:last_packet`);

		return [200, { status: "OK", active: active === "true", last_packet }];
	}
};
