import { FastifyInstance, RouteOptions, FastifyRequest, FastifyReply, RequestPayload } from "fastify";
import { Endpoint } from "../types/Endpoints";
import { registerRoutes } from "../utilities/routeHandler";

import root from "../endpoints/index/root";
import packet from "../endpoints/index/packet";
import register_server from "../endpoints/index/register_server";
import settings from "../endpoints/index/settings";
import server_info from "../endpoints/index/server_info";
import roblox_network_log from "../endpoints/index/roblox_network_log";
import network_fail from "../endpoints/reporting/network_fail";

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
		authType: "key",
		callback: async (request: FastifyRequest<{ Params: { server_id: string }; Body: { Packet: Array<any> } }>) => {
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
		authType: "key",
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
		authType: "key",
		callback: async (
			request: FastifyRequest<{
				Body: {
					server_id: string;
					logs: {
						network_name: string;
						speed: number;
						response: string;
						player: { name: string; id: number };
					}[];
				};
			}>,
		) => {
			return await roblox_network_log(request);
		},
	},
	{
		method: "POST",
		url: "/reporting/network_fail",
		authType: "key",
		callback: async (
			request: FastifyRequest<{
				Body: {
					network: string;
					networkData: { name: string; globalName: string; eventType: "Event" | "Function" };
					incorrectArg: { index?: number; value: string };
					player: number;
				};
			}>,
		) => {
			return await network_fail(request);
		},
	},
];

async function indexRoutes(fastify: FastifyInstance) {
	await registerRoutes(fastify, endpoints);
}

export default indexRoutes;
