import { FastifyRequest } from "fastify";
import { z } from "zod";
import { getPostgresConnection } from "../../service/postgres";
import { Trade } from "../../types/Endpoints";

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

		const connection = await getPostgresConnection();
		if (!connection) return [500, { error: "Failed to connect to the database" }];

		try {
			const { rows: trades } = await connection.query<Trade>(
				"SELECT * FROM trades WHERE trade_id = $1",
				[trade_id],
			);
			const trade = trades[0];
			if (!trade) return [404, { error: "Trade not found" }];
			if (trade.status !== "pending") return [400, { error: "Trade is not active" }];

			await connection.query(
				"UPDATE trades SET status = $1, updated_at = NOW() WHERE trade_id = $2",
				[user_role === "initiator" ? "cancelled" : "declined", trade_id],
			);

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
