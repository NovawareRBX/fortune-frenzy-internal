import { FastifyInstance, FastifyRequest } from "fastify";
import { Endpoint } from "../types/Endpoints";
import { registerRoutes } from "../utilities/routeHandler";
import create from "../endpoints/coinflip/create";

const endpoints: Endpoint[] = [
	{
		method: "POST",
		url: "/coinflip/create/:server_id",
		authType: "server_key",
		callback: async (
			request: FastifyRequest<{
                Params: { server_id: string };
                Body: { user_id: Number; items: Array<string>; coin: 1 | 2; type: "server" | "global" | "friends" };
            }>,
		) => {
			return await create(request);
		},
	},
];

async function coinflipRoutes(fastify: FastifyInstance) {
	await registerRoutes(fastify, endpoints);
}

export default coinflipRoutes;
