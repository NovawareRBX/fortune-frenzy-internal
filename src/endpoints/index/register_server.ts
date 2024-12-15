import { FastifyRequest } from "fastify";
import { getMariaConnection } from "../../service/mariadb";
import { getRedisConnection } from "../../service/redis";
import { createHash, randomBytes } from "crypto";

export default async function (request: FastifyRequest<{ Params: { server_id: string } }>): Promise<[number, any]> {
	const server_id = request.params.server_id;
	const maria = await getMariaConnection();
	const redis = await getRedisConnection();

	if (!maria || !redis) {
		return [500, { error: "Failed to connect to the database" }];
	}

	await maria.query("INSERT INTO active_roblox_servers (id) VALUES (?)", [server_id]);

	const initial_api_key = randomBytes(32).toString("hex");
	await redis.set(`api_key:${server_id}`, createHash("sha256").update(initial_api_key).digest("hex"), {
		EX: 60 * 5,
	});

	maria.release();
	return [200, { status: "OK", api_key: initial_api_key }];
}