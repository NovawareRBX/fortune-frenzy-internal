import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { register, Counter } from "prom-client";

// Export counters so they can be used in server.ts
export const requestCounter = new Counter({
	name: "http_requests_total",
	help: "Total number of HTTP requests",
	labelNames: ["method", "route", "status_code"],
});

export const rpsCounter = new Counter({
	name: "http_requests_per_second",
	help: "Number of HTTP requests per second",
	labelNames: ["method", "route"],
});

export async function metricsPlugin(fastify: FastifyInstance) {
	// Expose metrics endpoint
	fastify.get("/metrics", async (request: FastifyRequest, reply: FastifyReply) => {
		reply.header("Content-Type", register.contentType);
		return register.metrics();
	});
}