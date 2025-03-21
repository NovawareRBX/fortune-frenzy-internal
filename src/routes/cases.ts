import { FastifyInstance, RouteOptions, FastifyRequest, FastifyReply, RequestPayload } from "fastify";
import { Endpoint } from "../types/Endpoints";
import { registerRoutes } from "../utilities/routeHandler";
import get_cases from "../endpoints/cases/get_cases";
import open_case from "../endpoints/cases/open_case";
import regenerate_cases from "../endpoints/cases/regenerate_cases";

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
		authType: "key",
		callback: async (
			request: FastifyRequest<{ Params: { id: string }; Body: { user_id: string; lucky: boolean } }>,
		) => {
			return await open_case(request);
		},
	},
	{
		method: "POST",
		url: "/cases/regenerate",
		authType: "key",
		callback: async (_request: FastifyRequest) => {
			return await regenerate_cases();
		},
	},
];

async function casesRoutes(fastify: FastifyInstance) {
	await registerRoutes(fastify, endpoints);
}

export default casesRoutes;
