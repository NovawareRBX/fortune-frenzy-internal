import { FastifyInstance, RouteOptions, FastifyRequest, FastifyReply, RequestPayload } from "fastify";
import { Endpoint } from "../types/Endpoints";
import { registerRoutes } from "../utilities/routeHandler";
import item_transfer from "../endpoints/items/item_transfer";
import confirm_item_transfer from "../endpoints/items/confirm_item_transfer";

const endpoints: Endpoint[] = [
	{
		method: "POST",
		url: "/items/item-transfer",
		authType: "none",
		callback: async (
			request: FastifyRequest<{
				Body: Array<{
					user_id: string;
					items: string[];
				}>;
			}>,
		) => {
			return await item_transfer(request);
		},
	},
	{
		method: "POST",
		url: "/items/item-transfer/:transfer_id/confirm",
		authType: "none",
		callback: async (
			request: FastifyRequest<{
				Body?: {
					user_id: string;
				};
				Params: {
					transfer_id: string;
				};
				Querystring: {
					swap?: boolean;
				};
			}>,
		) => {
			return await confirm_item_transfer(request);
		},
	},
];

async function itemRoutes(fastify: FastifyInstance) {
	await registerRoutes(fastify, endpoints);
}

export default itemRoutes;
