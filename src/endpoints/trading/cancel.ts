import { FastifyRequest } from "fastify";
import { z } from "zod";
import { getMariaConnection } from "../../service/mariadb";
import { Trade, TradeItem } from "../../types/Endpoints";
import smartQuery from "../../utilities/smartQuery";
import getUserInfo from "../../utilities/getUserInfo";
import getItemString from "../../utilities/getItemString";

const cancelTradeParamsSchema = z.object({
	trade_id: z.string().regex(/^\d+$/),
});

const cancelTradeBodySchema = z.object({
	user_role: z.enum(["initiator", "receiver"]),
});

export default {
	method: "POST",
	url: "/trades/:trade_id/cancel",
	authType: "key",
	callback: async function cancel_trade(
		request: FastifyRequest<{
			Params: { trade_id: string };
			Body: { user_role: "initiator" | "receiver" };
		}>,
	): Promise<[number, any]> {
		// Validate request
		const paramsParse = cancelTradeParamsSchema.safeParse(request.params);
		const bodyParse = cancelTradeBodySchema.safeParse(request.body);
		if (!paramsParse.success || !bodyParse.success) {
			return [
				400,
				{
					error: "Invalid request",
					errors: {
						params: !paramsParse.success ? paramsParse.error.flatten() : undefined,
						body: !bodyParse.success ? bodyParse.error.flatten() : undefined,
					},
				},
			];
		}

		const { trade_id } = paramsParse.data;
		const { user_role } = bodyParse.data;

		const connection = await getMariaConnection();
		if (!connection) return [500, { error: "Failed to connect to the database" }];

		try {
			const [trade] = await smartQuery(connection, "SELECT * FROM trades WHERE trade_id = ?", [trade_id]);
			if (!trade) return [404, { error: "Trade not found" }];
			if (trade.status !== "pending") return [400, { error: "Trade is not active" }];

			await smartQuery(connection, "UPDATE trades SET status = ? WHERE trade_id = ?", [
				user_role === "initiator" ? "cancelled" : "declined",
				trade_id,
			]);

			return [
				200,
				{
					status: "OK",
					tradeStatus: user_role === "initiator" ? "cancelled" : "declined",
				},
			];
		} catch (error) {
			console.error(error);
			return [500, { error: "Internal Server Error" }];
		} finally {
			connection.release();
		}
	},
};
