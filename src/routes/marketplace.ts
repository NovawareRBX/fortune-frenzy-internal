import { FastifyInstance, FastifyRequest } from "fastify";
import { Endpoint } from "../types/Endpoints";
import { registerRoutes } from "../utilities/routeHandler";

import items_specific from "../endpoints/marketplace/items_specific";
import items_all from "../endpoints/marketplace/items_all";
import list_item from "../endpoints/marketplace/list_item";
import get_listings from "../endpoints/marketplace/get_listings";
import get_owners from "../endpoints/marketplace/get_owners";
import buy_uaid from "../endpoints/marketplace/buy_uaid";

const endpoints: Endpoint[] = [
	{
		method: "GET",
		url: "/marketplace/items/:id",
		authType: "none",
		callback: async (request: FastifyRequest<{ Params: { id: string } }>) => {
			return await items_specific(request);
		},
	},
	{
		method: "GET",
		url: "/marketplace/items",
		authType: "none",
		callback: async () => {
			return await items_all();
		},
	},
	{
		method: "GET",
		url: "/marketplace/items/:id/listings",
		authType: "none",
		callback: async (request: FastifyRequest<{ Params: { id: string } }>) => {
			return await get_listings(request);
		},
	},
	{
		method: "GET",
		url: "/marketplace/items/:id/owners",
		authType: "none",
		callback: async (request: FastifyRequest<{ Params: { id: string } }>) => {
			return await get_owners(request);
		},
	},
	{
		method: "GET",
		url: "/marketplace/items/listings",
		authType: "none",
		callback: async (request: FastifyRequest<{ Params: { id?: string } }>) => {
			return await get_listings(request);
		},
	},
	{
		method: "POST",
		url: "/marketplace/copies/:uaid/list",
		authType: "server_key",
		callback: async (request: FastifyRequest<{ Params: { uaid: string }; Body: { price?: number; expiry?: number } }>) => {
			if (request.body === undefined) return [400, { error: "Missing body" }];
			return list_item(request);
		},
	},
	{
		method: "POST",
		url: "/marketplace/copies/:uaid/buy",
		authType: "server_key",
		callback: async (request: FastifyRequest<{ Params: { uaid: string }; Body: { buyer_id?: string } }>) => {
			return await buy_uaid(request);
		},
	},
];

async function marketplaceRoutes(fastify: FastifyInstance) {
	await registerRoutes(fastify, endpoints);
}

export default marketplaceRoutes;
