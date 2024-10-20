import { FastifyInstance, FastifyRequest } from "fastify";
import { Endpoint } from "../types/Endpoints";
import { registerRoutes } from "../utilities/routeHandler";
import items_specific from "../endpoints/marketplace/items_specific";
import items_all from "../endpoints/marketplace/items_all";

const endpoints: Endpoint[] = [
	{
		method: "GET",
		url: "/marketplace/items/:id",
		authType: "none",
		callback: async (request: FastifyRequest<{ Params: { id: string } }>) => {
			return await items_specific(request);
		},
	},
	{
		method: "GET",
		url: "/marketplace/items",
		authType: "none",
		callback: async (_request: FastifyRequest) => {
			return await items_all();
		},
	},
];

async function marketplaceRoutes(fastify: FastifyInstance) {
	await registerRoutes(fastify, endpoints);
}

export default marketplaceRoutes;
