import { FastifyInstance, RouteOptions, FastifyRequest, FastifyReply } from "fastify";
import { getRedisConnection } from "../service/redis"; // Replace with your actual imports
import { randomBytes, createHash } from "crypto";
import { Endpoint } from "../types/Endpoints";
import { authorization } from "../middleware/authorization";

async function logRequest(request: FastifyRequest, reply: FastifyReply, payload: unknown) {
	try {
		const redis = await getRedisConnection();
		redis.publish(
			"http_network_log",
			Buffer.from(
				JSON.stringify({
					url: request.url,
					method: request.method,
					response: {
						status_code: reply.statusCode,
						payload,
					},
				}),
			),
		);
	} catch (error) {}
}

export async function registerRoutes(fastify: FastifyInstance, endpoints: Endpoint[]) {
	endpoints.forEach((endpoint) => {
		const routeOptions: RouteOptions = {
			method: endpoint.method,
			url: endpoint.url,
			handler: async (request: FastifyRequest, reply: FastifyReply) => {
				const [statusCode, response] = await endpoint.callback(
					request as FastifyRequest<{ Params: any; Body: any; Querystring: any; Headers: any }>,
					reply,
				);

				logRequest(request, reply, response);
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
