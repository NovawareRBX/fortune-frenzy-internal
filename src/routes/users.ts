import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { Endpoint } from "../types/Endpoints";
import { registerRoutes } from "../utilities/routeHandler";

import post_user from "../endpoints/users/post_user";
import user_inventory from "../endpoints/users/user_inventory";
import add_cash from "../endpoints/users/add_cash";
import get_cash_changes from "../endpoints/users/get_cash_changes";
import user_count from "../endpoints/users/user_count";
import update_users from "../endpoints/users/update_users";

const endpoints: Endpoint[] = [
	{
		method: "POST",
		url: "/users/:id",
		authType: "server_key",
		callback: async (
			request: FastifyRequest<{ Params: { id: string }; Body: { name?: string; displayName?: string } }>,
		) => {
			return await post_user(request);
		},
	},
	{
		method: "POST",
		url: "/users/update",
		authType: "server_key",
		callback: async (
			request: FastifyRequest<{
				Body: {
					user_id: string;
					name: string;
					display_name: string;
					total_cash_earned: number;
					total_cash_spent: number;
					win_rate: number;
					biggest_win: number;
					total_plays: number;
					favourite_mode: string;
					time_played: number;
					recent_activity: {
						text: string;
						icon: string;
					}[];
				}[];
			}>,
		) => {
			return await update_users(request);
		},
	},
	{
		method: "GET",
		url: "/users/:id/inventory",
		authType: "none",
		callback: async (request: FastifyRequest<{ Params: { id: string } }>) => {
			return await user_inventory(request);
		},
	},
	{
		method: "POST",
		url: "/users/:id/add-cash",
		authType: "server_key",
		callback: async (request: FastifyRequest<{ Params: { id: string } }>) => {
			return await add_cash(request);
		},
	},
	{
		method: "GET",
		url: "/users/get-cash-changes",
		authType: "server_key",
		callback: async (request: FastifyRequest) => {
			return await get_cash_changes(request);
		},
	},
	{
		method: "GET",
		url: "/users/total",
		authType: "none",
		callback: async (request: FastifyRequest) => {
			return await user_count(request);
		},
	},
];

async function userRoutes(fastify: FastifyInstance) {
	await registerRoutes(fastify, endpoints);
}

export default userRoutes;
