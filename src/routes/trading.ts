import { FastifyInstance, RouteOptions, FastifyRequest, FastifyReply, RequestPayload } from "fastify";
import { Endpoint } from "../types/Endpoints";
import { registerRoutes } from "../utilities/routeHandler";
import get_trades from "../endpoints/trading/get_trades";

const endpoints: Endpoint[] = [
    {
        method: "GET",
        url: "/trades/:user_ids",
        authType: "none",
        callback: async (request: FastifyRequest<{ Params: { user_ids: string } }>) => {
            return await get_trades(request);
        },
    },
];

async function tradingRoutes(fastify: FastifyInstance) {
    await registerRoutes(fastify, endpoints);
}

export default tradingRoutes;
