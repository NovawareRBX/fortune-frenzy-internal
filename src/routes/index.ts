import { FastifyInstance, RouteOptions, FastifyRequest, FastifyReply, RequestPayload } from "fastify";
import { Endpoint } from "../types/Endpoints";
import { registerRoutes } from "../utilities/routeHandler";

import root from "../endpoints/index/root";
import packet from "../endpoints/index/packet";
import register_server from "../endpoints/index/register_server";
import settings from "../endpoints/index/settings";
import server_info from "../endpoints/index/server_info";
import roblox_network_log from "../endpoints/index/roblox_network_log";

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
		method: "GET",
		url: "/server/:server_id",
		authType: "none",
		callback: async (request: FastifyRequest<{ Params: { server_id: string } }>) => {
			return await server_info(request);
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
	{
		method: "POST",
		url: "/logging/network",
		authType: "server_key",
		callback: async (request: FastifyRequest<{
			Body: {
				server_id: string;
				logs: {
					network_name: string;
					speed: number;
					response: string;
					player: { name: string; id: number };
				}[];
			};
		}>) => {
			return await roblox_network_log(request);
		},
	}
];

async function indexRoutes(fastify: FastifyInstance) {
	await registerRoutes(fastify, endpoints);
}

export default indexRoutes;
