import { FastifyInstance, RouteOptions, FastifyRequest, FastifyReply, RequestPayload } from "fastify";
import { Endpoint } from "../types/Endpoints";
import { registerRoutes } from "../utilities/routeHandler";
import get_cases from "../endpoints/cases/get_cases";
import open_case from "../endpoints/cases/open_case";

const endpoints: Endpoint[] = [
	{
		method: "GET",
		url: "/cases",
		authType: "none",
		callback: async (_request: FastifyRequest) => {
			return await get_cases();
		},
	},
	{
		method: "POST",
		url: "/cases/open/:id",
		authType: "none",
		callback: async (request: FastifyRequest<{ Params: { id: string }; Body: { user_id: string } }>) => {
			return await open_case(request);
		},
	},
];

async function casesRoutes(fastify: FastifyInstance) {
	await registerRoutes(fastify, endpoints);
}

export default casesRoutes;
