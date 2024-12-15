import { FastifyInstance, RouteOptions, FastifyRequest, FastifyReply, RequestPayload } from "fastify";
import { Endpoint } from "../types/Endpoints";
import { registerRoutes } from "../utilities/routeHandler";

import root from "../endpoints/index/root";
import packet from "../endpoints/index/packet";
import register_server from "../endpoints/index/register_server";
import settings from "../endpoints/index/settings";

const endpoints: Endpoint[] = [
	{
		method: "GET",
		url: "/",
		authType: "none",
		callback: async (_request: FastifyRequest) => {
			return await root();
		},
	},
	{
		method: "POST",
		url: "/packet/:server_id",
		authType: "server_key",
		callback: async (request: FastifyRequest<{ Params: { server_id: string }; Body: { Packet: string } }>) => {
			return await packet(request);
		},
	},
	{
		method: "POST",
		url: "/register/:server_id",
		authType: "master_key",
		callback: async (request: FastifyRequest<{ Params: { server_id: string } }>) => {
			return await register_server(request);
		},
	},
	{
		method: "GET",
		url: "/settings/:game_id",
		authType: "none",
		callback: async (request: FastifyRequest<{ Params: { game_id: string } }>) => {
			return await settings(request);
		},
	},
];

async function indexRoutes(fastify: FastifyInstance) {
	await registerRoutes(fastify, endpoints);
}

export default indexRoutes;
