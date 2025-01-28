import { FastifyRequest, FastifyReply, HTTPMethods, FastifySchema } from "fastify";

export type AuthType = "none" | "server_key" | "master_key";

export interface Endpoint<Params = any, Body = any, Query = any, Headers = any> {
	method: HTTPMethods; // Defines the HTTP method (GET, POST, etc.)
	url: string; // The URL path for the endpoint
	authType: AuthType; // Custom type for authentication type
	requiredHeaders?: string[]; // Optional list of required headers
	schema?: FastifySchema; // Optional schema for validation
	callback: (
		request: FastifyRequest<{
			Params: Params;
			Body: Body;
			Querystring: Query; // Fixed: Use `Querystring` as per Fastify convention
			Headers: Headers;
		}>,
		reply: FastifyReply,
	) => Promise<[status: number, data: any]>; // Ensures a tuple is returned with status and data
}

export interface ItemListing {
	user_asset_id: string;
	seller_id: string;
	currency: string;
	created_at: string;
	expires_at: string | Date | null;
	price: string;
	item_id: string;
	username?: string;
	display_name?: string;
}

export interface ItemCase {
	price: number;
	id: string;
	next_rotation: Date;
	items: {
		id: string;
		chance: number;
		claimed: number;
	}[];
	ui_data: {
		primary: string;
		secondary: string;
		colour: string;
	};
	opened_count: number;
}

export interface Trade {
	trade_id: number;
	initiator_user_id: string;
	receiver_user_id: string;
	status: "pending" | "accepted" | "cancelled" | "completed";
	created_at: string;
	updated_at: string;
	transfer_id;
}

export interface TradeItem {
	item_uaid: string;
	trade_id: number;
	user_id: string;
}
