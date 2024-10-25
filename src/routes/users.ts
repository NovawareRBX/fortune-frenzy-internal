import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { Endpoint } from "../types/Endpoints";
import { registerRoutes } from "../utilities/routeHandler";

import user from "../endpoints/users/user";
import user_inventory from "../endpoints/users/user_inventory";
import add_cash from "../endpoints/users/add_cash";
import get_cash_changes from "../endpoints/users/get_cash_changes";

const endpoints: Endpoint[] = [
	{
		method: "POST",
		url: "/users/:id",
		authType: "server_key",
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
	{
		method: "POST",
		url: "/users/:id/add-cash",
		authType: "server_key",
		callback: async (request: FastifyRequest<{ Params: { id: string } }>) => {
			return await add_cash(request);
		},
	},
	{
		method: "GET",
		url: "/users/get-cash-changes",
		authType: "server_key",
		callback: async (request: FastifyRequest) => {
			return await get_cash_changes(request);
		},
	},
];

async function userRoutes(fastify: FastifyInstance) {
	await registerRoutes(fastify, endpoints);
}

export default userRoutes;
