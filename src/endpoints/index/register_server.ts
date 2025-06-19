import { FastifyRequest } from "fastify";
import { getPostgresConnection } from "../../service/postgres";
import { getRedisConnection } from "../../service/redis";
import { createHash, randomBytes } from "crypto";
import { z } from "zod";

function maskIP(ip: string): string {
	const parts = ip.split(".");

	if (parts.length !== 4) {
		return `X.X.X.X`;
	}

	return `${parts[0]}.${parts[1]}.X.X`;
}

const registerParamsSchema = z.object({
	server_id: z.string(),
});

export default {
	method: "POST",
	url: "/register/:server_id",
	authType: "key",
	callback: async function(request: FastifyRequest<{ Params: { server_id: string } }>): Promise<[number, any]> {
		const paramsParse = registerParamsSchema.safeParse(request.params);
		if (!paramsParse.success) {
			return [400, { error: "Invalid request", errors: paramsParse.error.flatten() }];
		}
		const { server_id } = paramsParse.data;
		const pgClient = await getPostgresConnection();
		const redis = await getRedisConnection();
		const ip_address = request.headers["cf-connecting-ip"] as string;

		if (!pgClient || !redis) {
			return [500, { error: "Failed to connect to the database" }];
		}

		await pgClient.query("INSERT INTO active_roblox_servers (id, ip_address) VALUES ($1, $2)", [server_id, ip_address]);

		const initial_api_key = randomBytes(32).toString("hex");
		await redis.set(`api_key:${server_id}`, createHash("sha256").update(initial_api_key).digest("hex"), {
			EX: 60 * 5,
		});

		console.log(`NEW API REGISTERED FOR SERVER ${server_id}: ${initial_api_key}`);
		console.log(`SAVED TO REDIS AS ${createHash("sha256").update(initial_api_key).digest("hex")}`);

		// i love my boyfriend
		pgClient.release();
		return [200, { status: "OK", api_key: initial_api_key }];
	}
};
