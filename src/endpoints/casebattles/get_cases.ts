import { FastifyRequest } from "fastify";
import { CasebattlesRedisManager } from "../../service/casebattles-redis";
import { getMariaConnection } from "../../service/mariadb";
import { getRedisConnection } from "../../service/redis";
import smartQuery from "../../utilities/smartQuery";

export interface CaseRow {
	id: string;
	name: string;
	slug: string;
	image: string;
	price: number;
	total_opened: number;
	created_at: Date;
}

export interface ItemRow {
	id: number;
	case_id: string;
	asset_id: string;
	asset_type: string;
	name: string;
	value: number;
	image: string;
	min_ticket: number;
	max_ticket: number;
}

export default {
	method: "GET",
	url: "/casebattles/cases",
	authType: "none",
	callback: async function callback(request: FastifyRequest): Promise<[number, any]> {
		const redis = await getRedisConnection();
		const casebattlesRedisManager = new CasebattlesRedisManager(redis, request.server);
		const cases = await casebattlesRedisManager.getCases();
		return [200, { status: "OK", data: cases }];
	},
};
