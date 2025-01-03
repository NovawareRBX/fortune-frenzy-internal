import { FastifyRequest, InjectOptions } from "fastify";
import { getRedisConnection } from "../service/redis";
import { randomBytes } from "crypto";

export default async function (request: FastifyRequest, inject: InjectOptions) {
	const redis = await getRedisConnection();
	const key = randomBytes(16).toString("hex");
	redis.set(`tempauth:${key}`, key, { EX: 60 });

	// make a request to the same server
	return await request.server.inject({
		...inject,
		headers: {
			...inject.headers,
			"internal-authentication": key,
		},
	});
}
