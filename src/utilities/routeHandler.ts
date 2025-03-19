import { FastifyInstance, RouteOptions, FastifyRequest, FastifyReply } from "fastify";
import { getRedisConnection } from "../service/redis"; // Replace with your actual imports
import { randomBytes, createHash } from "crypto";
import { Endpoint } from "../types/Endpoints";
import { authorization } from "../middleware/authorization";

async function logRequest(request: FastifyRequest, reply: FastifyReply, payload: unknown, executionTime?: number) {
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
					executionTime: executionTime ? `${executionTime}ms` : undefined,
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
				const startTime = process.hrtime();

				const [statusCode, response] = await endpoint.callback(
					request as FastifyRequest<{ Params: any; Body: any; Querystring: any; Headers: any }>,
					reply,
				);

				const [seconds, nanoseconds] = process.hrtime(startTime);
				const executionTime = seconds * 1000 + nanoseconds / 1000000;
				reply.header("X-Execution-Time", `${executionTime}ms`);
				reply.code(statusCode).send(response);

				console.log(JSON.stringify(response));

				logRequest(request, reply, response, executionTime);
			},
		};

		if (endpoint.authType !== "none") {
			routeOptions.preHandler = async (request: FastifyRequest, reply: FastifyReply, done: any) => {
				const authorized = await authorization(request, endpoint.authType, endpoint.requiredHeaders);
				if (!authorized) return reply.code(401).send({ error: "Unauthorized" });
			};
		}

		fastify.route(routeOptions);
	});
}
