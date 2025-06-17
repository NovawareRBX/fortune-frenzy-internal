import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { getRedisConnection } from "../service/redis";
import { authorization } from "../middleware/authorization";
import { glob } from "fast-glob";
import * as path from "path";

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

export async function registerAllRoutes(fastify: FastifyInstance) {
	const files = await glob("src/endpoints/**/*.ts", { absolute: true });

	for (const file of files) {
		try {
			const relativePath = path.relative(path.join(process.cwd(), 'src'), file);
			const distPath = path.join(process.cwd(), 'dist', relativePath.replace(/\.ts$/, '.js'));
			const route = require(distPath).default;
			if (!route?.method || !route?.url || !route?.callback) {
				console.log("Error loading route: ", file);
				continue;
			}

			fastify.route({
				method: route.method,
				url: route.url,
				preHandler: route.authType !== "none"
					? async (request, reply) => {
							const authorized = await authorization(request, route.authType, route.requiredHeaders);
							if (!authorized) return reply.code(401).send({ error: "Unauthorized" });
					  }
					: undefined,
				handler: async (request: FastifyRequest, reply: FastifyReply) => {
					const start = process.hrtime();
					const [status, body] = await route.callback(request, reply);
					const [s, ns] = process.hrtime(start);
					const time = s * 1000 + ns / 1e6;

					reply.header("X-Execution-Time", `${time.toFixed(2)}ms`);
					reply.code(status).send(body);

					logRequest(request, reply, body, time);
				},
			});
		} catch (error) {
			console.error(`Error loading route ${file}:`, error);
		}
	}
}