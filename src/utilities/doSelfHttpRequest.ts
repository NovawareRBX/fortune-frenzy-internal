import { FastifyInstance, FastifyRequest, InjectOptions } from "fastify";
import { getRedisConnection } from "../service/redis";
import { randomBytes } from "crypto";

export default async function (server: FastifyInstance, inject: InjectOptions) {
	const redis = await getRedisConnection();
	const key = randomBytes(16).toString("hex");
	redis.set(`tempauth:${key}`, key, { EX: 60 });

	// make a request to the same server
	return await server.inject({
		...inject,
		headers: {
			...inject.headers,
			"internal-authentication": key,
		},
	});
}
