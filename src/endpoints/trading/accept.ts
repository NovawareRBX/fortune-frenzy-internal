import { FastifyRequest } from "fastify";
import { z } from "zod";
import { getPostgresConnection } from "../../service/postgres";
import { Trade } from "../../types/Endpoints";
import doSelfHttpRequest from "../../utilities/internalRequest";

const tradeAcceptParamsSchema = z.object({
	trade_id: z.string().regex(/^\d+$/),
});

export default {
	method: "POST",
	url: "/trades/:trade_id/accept",
	authType: "key",
	callback: async function accept_trade(
		request: FastifyRequest<{ Params: { trade_id: string } }>,
	): Promise<[number, any]> {
		// Validate params using Zod
		const paramsParse = tradeAcceptParamsSchema.safeParse(request.params);
		if (!paramsParse.success) {
			return [400, { error: "Invalid request", errors: paramsParse.error.flatten() }];
		}

		const { trade_id } = paramsParse.data;

		const connection = await getPostgresConnection();
		if (!connection) {
			return [500, { error: "Failed to connect to the database" }];
		}

		try {
			const { rows: trades } = await connection.query<Trade>(
				`SELECT * FROM trades WHERE trade_id = $1`,
				[trade_id],
			);
			const trade_data = trades[0];

			if (!trade_data) return [404, { error: "Trade not found" }];
			if (trade_data.status !== "pending") return [400, { error: "Trade is not active" }];

			const response = await doSelfHttpRequest(request.server, {
				method: "POST",
				url: `/items/item-transfer/${trade_data.transfer_id}/confirm?swap=true`,
			});

			if (response.statusCode !== 200) {
				await connection.query(`UPDATE trades SET status = 'failed', updated_at = NOW() WHERE trade_id = $1`, [trade_id]);

				if (response.statusCode === 403) return [400, { error: "One or more items owner changed" }];

				return [500, { error: "Item transfer failed" }];
			}

			await connection.query(`UPDATE trades SET status = 'accepted', updated_at = NOW() WHERE trade_id = $1`, [trade_id]);

			return [
				200,
				{
					status: "OK",
					tradeStatus: "accepted",
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
