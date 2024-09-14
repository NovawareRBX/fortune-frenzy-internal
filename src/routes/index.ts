import { FastifyInstance, RouteOptions, FastifyRequest, FastifyReply, RequestPayload } from "fastify";
import { Endpoint } from "../types/Endpoints";
import { packeter } from "../utilities/packeter";
import { getMariaConnection } from "../service/mariadb";
import { getRedisConnection } from "../service/redis";
import { createHash, randomBytes } from "crypto";
import { authorization } from "../middleware/authorization";

interface Params {
	server_id: string;
}

interface Body {
	Packet: string;
}

const endpoints: Endpoint<Params, Body>[] = [
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
		callback: async (request: FastifyRequest<{ Params: Params; Body: Body }>, reply: FastifyReply) => {
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
		callback: async (request: FastifyRequest<{ Params: Params }>, reply: FastifyReply) => {
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
	endpoints.forEach((endpoint) => {
		const routeOptions: RouteOptions = {
			method: endpoint.method,
			url: endpoint.url,
			handler: async (request: FastifyRequest, reply: FastifyReply) => {
				const [statusCode, response] = await endpoint.callback(
					request as FastifyRequest<{ Params: Params; Body: Body }>,
					reply,
				);
				reply.code(statusCode).send(response);
			},
		};

		if (endpoint.authType !== "none") {
			routeOptions.preHandler = async (request: FastifyRequest, reply: FastifyReply, done: any) => {
				await authorization(request, endpoint.authType, endpoint.requiredHeaders);

				if (endpoint.authType === "server_key" && !request.headers["packeter-master-key"]) {
					const server_id = request.headers["server-id"] as string;
					const redis = await getRedisConnection();
					const new_api_key = randomBytes(32).toString("hex");
					await redis.set(`api_key:${server_id}`, createHash("sha256").update(new_api_key).digest("hex"), {
						EX: 60 * 5,
					});
					reply.header("new-api-key", new_api_key);
				}

				return;
			};
		}

		fastify.route(routeOptions);
	});
}

export default indexRoutes;
