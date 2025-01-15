import { FastifyRequest } from "fastify";
import { getMariaConnection } from "../../service/mariadb";
import { Trade, TradeItem } from "../../types/Endpoints";
import smartQuery from "../../utilities/smartQuery";
import doSelfHttpRequest from "../../utilities/doSelfHttpRequest";

export default async function (
	request: FastifyRequest<{
		Params: { trade_id: string };
		Body: { user_role: "initiator" | "receiver" };
	}>,
): Promise<[number, any]> {
	const connection = await getMariaConnection();
	if (!connection) return [500, { error: "Failed to connect to the database" }];

	try {
		const { trade_id } = request.params;
		const { user_role } = request.body;

		if (isNaN(Number(trade_id))) return [400, { error: "Invalid trade_id" }];

		const [trade] = await smartQuery(connection, "SELECT * FROM trades WHERE trade_id = ?", [trade_id]);
		if (!trade) return [404, { error: "Trade not found" }];
		if (trade.status !== "pending") return [400, { error: "Trade is not active" }];

		await smartQuery(connection, "UPDATE trades SET status = ? WHERE trade_id = ?", [
			user_role === "initiator" ? "canceled" : "declined",
			trade_id,
		]);

		return [
			200,
			{
				status: "OK",
				trade: {
					...trade,
					status: user_role === "initiator" ? "canceled" : "declined",
				},
			},
		];
	} catch (error) {
		console.error(error);
		return [500, { error: "Internal Server Error" }];
	} finally {
		connection.release();
	}
}
