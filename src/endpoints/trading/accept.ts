import { FastifyRequest } from "fastify";
import { getMariaConnection } from "../../service/mariadb";
import { Trade, TradeItem } from "../../types/Endpoints";
import smartQuery from "../../utilities/smartQuery";
import doSelfHttpRequest from "../../utilities/doSelfHttpRequest";

export default async function (
	request: FastifyRequest<{
		Params: { trade_id: string };
	}>,
): Promise<[number, any]> {
	const connection = await getMariaConnection();
	if (!connection) {
		return [500, { error: "Failed to connect to the database" }];
	}

	try {
		if (isNaN(Number(request.params.trade_id))) {
			return [400, { error: "Invalid trade_id" }];
		}

		const [trade_data] = (await smartQuery(connection, `SELECT * FROM trades WHERE trade_id = ?`, [
			request.params.trade_id,
		])) as Trade[];

		if (!trade_data) return [404, { error: "Trade not found" }];
		if (trade_data.status !== "pending") return [400, { error: "Trade is not active" }];

		const response = await doSelfHttpRequest(request, {
			method: "POST",
			url: `/items/item-transfer/${trade_data.transfer_id}/confirm?swap=true`,
		});

		if (response.statusCode !== 200) {
			await smartQuery(connection, `UPDATE trades SET status = 'failed' WHERE trade_id = ?`, [
				request.params.trade_id,
			]);

			if (response.statusCode === 403) return [400, { error: "One or more items owner changed" }];
			return [500, { error: "Item transfer failed" }];
		}

		await smartQuery(connection, `UPDATE trades SET status = 'accepted' WHERE trade_id = ?`, [
			request.params.trade_id,
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
}
