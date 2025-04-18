import { FastifyInstance, RouteOptions, FastifyRequest, FastifyReply, RequestPayload } from "fastify";
import { Endpoint } from "../types/Endpoints";
import { registerRoutes } from "../utilities/routeHandler";
import transcript from "../endpoints/discord/transcript";
import user_info from "../endpoints/discord/user_info";

const endpoints: Endpoint[] = [
	{
		method: "GET",
		url: "/discord/transcript/:transcript_id",
		authType: "none",
		callback: async (
			request: FastifyRequest<{
				Params: {
					transcript_id: string;
				};
			}>,
		) => {
			return await transcript(request);
		},
	},
	{
		method: "GET",
		url: "/discord/user/:user_id",
		authType: "none",
		callback: async (request: FastifyRequest<{ Params: { user_id: string } }>) => {
			return await user_info(request);
		},
	},
];

async function discordRoutes(fastify: FastifyInstance) {
	await registerRoutes(fastify, endpoints);
}

export default discordRoutes;
