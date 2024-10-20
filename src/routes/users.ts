import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { Endpoint } from "../types/Endpoints";
import { registerRoutes } from "../utilities/routeHandler";
import user from "../endpoints/users/user";
import user_inventory from "../endpoints/users/user_inventory";

const endpoints: Endpoint[] = [
	{
		method: "GET",
		url: "/users/:id",
		authType: "none",
		callback: async (request: FastifyRequest<{ Params: { id: string } }>) => {
			return await user(request);
		},
	},
	{
		method: "GET",
		url: "/users/:id/inventory",
		authType: "none",
		callback: async (request: FastifyRequest<{ Params: { id: string } }>) => {
			return await user_inventory(request);
		},
	},
];

async function userRoutes(fastify: FastifyInstance) {
	await registerRoutes(fastify, endpoints);
}

export default userRoutes;
