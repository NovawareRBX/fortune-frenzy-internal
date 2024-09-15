import { FastifyInstance, RouteOptions, FastifyRequest, FastifyReply, RequestPayload } from "fastify";
import { Endpoint } from "../types/Endpoints";
import { packeter } from "../utilities/packeter";
import { getMariaConnection } from "../service/mariadb";
import { getRedisConnection } from "../service/redis";
import { createHash, randomBytes } from "crypto";
import { authorization } from "../middleware/authorization";
import { registerRoutes } from "../utilities/routeHandler";

const endpoints: Endpoint[] = [
	{
		method: "GET",
		url: "/",
		authType: "none",
		callback: async (_request: FastifyRequest, _reply: FastifyReply) => {
			return [200, { status: "OK" }];
		},
	},
	{
		method: "POST",
		url: "/packet/:server_id",
		authType: "server_key",
		callback: async (
			request: FastifyRequest<{ Params: { server_id: string }; Body: { Packet: string } }>,
			reply: FastifyReply,
		) => {
			return await packeter(
				request.server,
				request.params.server_id,
				JSON.parse(Buffer.from(request.body.Packet, "base64").toString("utf-8")),
			);
		},
	},
	{
		method: "POST",
		url: "/register/:server_id",
		authType: "master_key",
		callback: async (request: FastifyRequest<{ Params: { server_id: string } }>, reply: FastifyReply) => {
			const server_id = request.params.server_id;
			const maria = await getMariaConnection();
			const redis = await getRedisConnection();

			await maria.query("INSERT INTO active_roblox_servers (id) VALUES (?)", [server_id]);

			const initial_api_key = randomBytes(32).toString("hex");
			await redis.set(`api_key:${server_id}`, createHash("sha256").update(initial_api_key).digest("hex"), {
				EX: 60 * 5,
			});

			maria.release();
			return [200, { status: "OK", api_key: initial_api_key }];
		},
	},
];

async function indexRoutes(fastify: FastifyInstance) {
	await registerRoutes(fastify, endpoints);
}

export default indexRoutes;
