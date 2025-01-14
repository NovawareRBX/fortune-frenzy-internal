import { FastifyInstance, RouteOptions, FastifyRequest, FastifyReply, RequestPayload } from "fastify";
import { Endpoint } from "../types/Endpoints";
import { registerRoutes } from "../utilities/routeHandler";

import get_trades from "../endpoints/trading/get_trades";
import create from "../endpoints/trading/create";
import accept from "../endpoints/trading/accept";

const endpoints: Endpoint[] = [
	{
		method: "GET",
		url: "/trades/:user_ids",
		authType: "none",
		callback: async (request: FastifyRequest<{ Params: { user_ids: string } }>) => {
			return await get_trades(request);
		},
	},
	{
		method: "POST",
		url: "/trades/create",
		authType: "server_key",
		callback: async (
			request: FastifyRequest<{
				Body: {
					initiator_id: string;
					receiver_id: string;
					initiator_items: string[];
					receiver_items: string[];
				};
			}>,
		) => {
			return await create(request);
		},
	},
	{
		method: "POST",
		url: "/trades/accept/:trade_id",
		authType: "server_key",
		callback: async (
			request: FastifyRequest<{
				Params: { trade_id: string };
			}>,
		) => {
			return await accept(request);
		},
	},
];

async function tradingRoutes(fastify: FastifyInstance) {
	await registerRoutes(fastify, endpoints);
}

export default tradingRoutes;
