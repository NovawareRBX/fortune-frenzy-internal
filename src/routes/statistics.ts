import { FastifyInstance, RouteOptions, FastifyRequest, FastifyReply, RequestPayload } from "fastify";
import { Endpoint } from "../types/Endpoints";
import { registerRoutes } from "../utilities/routeHandler";
import minigames_update from "../endpoints/statistics/minigames_update";
import minigames_get from "../endpoints/statistics/minigames_get";

const endpoints: Endpoint[] = [
	{
		method: "POST",
		url: "/statistics/minigames/:name",
		authType: "key",
		callback: async (
			request: FastifyRequest<{
				Params: { name: string };
				Body: {
					current_ccu: number;
					total_spent: number;
					total_games_played: number;
					total_wins?: number;
					total_losses?: number;
				};
			}>,
		) => {
			return await minigames_update(request);
		},
	},
	{
		method: "GET",
		url: "/statistics/minigames",
		authType: "none",
		callback: async (request: FastifyRequest) => {
			return await minigames_get(request);
		},
	},
];

async function statisticsRoutes(fastify: FastifyInstance) {
	await registerRoutes(fastify, endpoints);
}

export default statisticsRoutes;
