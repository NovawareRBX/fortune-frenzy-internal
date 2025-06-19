import Fastify from "fastify";
import fastifyCompress from "@fastify/compress";
import fastifyCors from "@fastify/cors";
import dotenv from "dotenv";
import cluster from "cluster";
import { cpus } from "os";
import { FastifyRequest, FastifyReply } from "fastify";

dotenv.config();

import { metricsPlugin, requestCounter, rpsCounter } from "./middleware/metrics";
import { registerAllRoutes } from "./utilities/routeHandler";

declare module "fastify" {
	interface FastifyRequest {
		startTime?: [number, number];
	}
}

const numCPUs = cpus().length;
if (cluster.isPrimary) {
	console.log(`Primary process ${process.pid} is running`);

	for (let i = 0; i < numCPUs; i++) {
		cluster.fork();
	}

	cluster.on("exit", (worker, code, signal) => {
		console.log(`Worker ${worker.process.pid} died. Forking a new worker.`);
		cluster.fork();
	});
} else {
	const server = Fastify({
		ignoreTrailingSlash: true,
		bodyLimit: 10 * 1024 * 1024,
	});

	const start = async () => {
		try {
			await server.register(fastifyCors, {
				origin: ["https://trcs.frazers.co"],
				methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
				credentials: true,
			});

			server.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
				if (request.url === "/metrics") return;
				console.log(`[Request]: ${request.method} ${request.url}`);
				request.startTime = process.hrtime();
			});

			server.addHook("onResponse", async (request: FastifyRequest, reply: FastifyReply) => {
				if (request.url === "/metrics") return;
				const route = request.routeOptions?.url || request.url.split("?")[0] || "unknown";
				const method = request.method;
				const statusCode = reply.statusCode.toString();

				requestCounter.inc({ method, route, status_code: statusCode });
				rpsCounter.inc({ method, route });
			});

			await server.register(metricsPlugin);
			await registerAllRoutes(server);
			await server.listen({ port: 3000, host: "0.0.0.0" });

			console.log(`Worker ${process.pid} is running on port 3000`);
		} catch (error) {
			console.log("Error starting server");
			console.log(error);
			server.log.error(error);
			process.exit(1);
		}
	};

	start();
}
