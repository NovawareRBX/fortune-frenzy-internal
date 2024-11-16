import { FastifyRequest, FastifyReply, HTTPMethods, FastifySchema } from "fastify";

export type AuthType = "none" | "server_key" | "master_key";

export interface Endpoint<Params = any, Body = any, Query = any, Headers = any> {
	method: HTTPMethods;
	url: string;
	authType: AuthType;
	requiredHeaders?: Array<string>;
	schema?: FastifySchema;
	callback: (
		request: FastifyRequest<{
			Params: Params;
			Body: Body;
			Query?: Query;
			Headers?: Headers;
		}>,
		reply: FastifyReply,
	) => Promise<[status: number, data: any]>;
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
	displayName?: string;
}

export interface ItemCase {
	id: string;
	next_rotation: Date;
	items: {
		id: string;
		chance: number;
	}[];
	ui_data: {
		primary: string;
		secondary: string;
		colour: string;
	};
}
