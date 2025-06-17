import { FastifyRequest } from "fastify";
import { z } from "zod";
import { getMariaConnection } from "../../service/mariadb";
import { Trade, TradeItem } from "../../types/Endpoints";
import smartQuery from "../../utilities/smartQuery";
import getUserInfo from "../../utilities/getUserInfo";
import getItemString from "../../utilities/getItemString";
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

		const connection = await getMariaConnection();
		if (!connection) {
			return [500, { error: "Failed to connect to the database" }];
		}

		try {
			const [trade_data] = (await smartQuery(connection, `SELECT * FROM trades WHERE trade_id = ?`, [
				trade_id,
			])) as Trade[];

			if (!trade_data) return [404, { error: "Trade not found" }];
			if (trade_data.status !== "pending") return [400, { error: "Trade is not active" }];

			const response = await doSelfHttpRequest(request.server, {
				method: "POST",
				url: `/items/item-transfer/${trade_data.transfer_id}/confirm?swap=true`,
			});

			if (response.statusCode !== 200) {
				await smartQuery(connection, `UPDATE trades SET status = 'failed' WHERE trade_id = ?`, [
					trade_id,
				]);

				if (response.statusCode === 403) return [400, { error: "One or more items owner changed" }];

				return [500, { error: "Item transfer failed" }];
			}

			await smartQuery(connection, `UPDATE trades SET status = 'accepted' WHERE trade_id = ?`, [
				trade_id,
			]);

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
