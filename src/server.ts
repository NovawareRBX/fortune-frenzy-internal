import Fastify from "fastify";
import fastifyCors from "@fastify/cors";
import dotenv from "dotenv";
import cluster from "cluster";
import { cpus } from "os";
import { spawn } from "child_process";
import { FastifyRequest, FastifyReply } from "fastify";

dotenv.config();

import { metricsPlugin, requestCounter, rpsCounter } from "./middleware/metrics";
import { registerAllRoutes } from "./utilities/routeHandler";
import ensureSystemJackpots from "./service/jackpot/system-jackpots";
import runJackpotScheduler from "./service/jackpot/jackpot-scheduler";
import runCaseBattleScheduler from "./service/casebattles-scheduler";
import runCaseRegenerationScheduler from "./service/cases-regeneration-scheduler";

declare module "fastify" {
	interface FastifyRequest {
		startTime?: [number, number];
	}
}

const numCPUs = cpus().length;
if (cluster.isPrimary) {
	console.log(`Primary process ${process.pid} is running`);

	const startRustService = () => {
		const rustProc = spawn("item-range-svc", { stdio: "inherit" });
		rustProc.on("exit", (code, signal) => {
			console.error(
				`Rust microservice exited with ${
					code !== null ? `code ${code}` : `signal ${signal}`
				}. Restarting...`
			);
			setTimeout(startRustService, 1000);
		});
	};

	startRustService();

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

			await ensureSystemJackpots(server);
			setInterval(() => ensureSystemJackpots(server).catch(() => {}), 2_000);
			setInterval(() => runJackpotScheduler(server).catch(() => {}), 300);
			setInterval(() => runCaseBattleScheduler(server).catch(() => {}), 300);
			// Start case regeneration scheduler; it will self-schedule future runs
			runCaseRegenerationScheduler(server).catch(() => {});

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
