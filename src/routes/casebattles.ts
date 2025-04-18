import { FastifyInstance, RouteOptions, FastifyRequest, FastifyReply, RequestPayload } from "fastify";
import { Endpoint } from "../types/Endpoints";
import { registerRoutes } from "../utilities/routeHandler";
import get_cases from "../endpoints/casebattles/get_cases";

const endpoints: Endpoint[] = [
	{
		method: "GET",
		url: "/casebattles/cases",
		authType: "none",
		callback: async (_request: FastifyRequest) => {
			return await get_cases();
		},
	},
];

async function casebattleRoutes(fastify: FastifyInstance) {
	await registerRoutes(fastify, endpoints);
}

export default casebattleRoutes;
