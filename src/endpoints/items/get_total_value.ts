import { FastifyRequest } from "fastify";
import getTotalValue from "../../utilities/getTotalValue";

export default {
	method: "GET",
	url: "/items/get_total_value",
	authType: "none",
	callback: async (
		request: FastifyRequest<{
			Querystring: {
				items: string;
			};
		}>,
	) => {
		let { items } = request.query;
		const uaids: string[] = Array.isArray(items) ? items : items.split(",");

		const totalValue = await getTotalValue(uaids);
		return [200, { total_value: totalValue }];
	},
};
