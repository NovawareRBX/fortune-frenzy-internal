import { FastifyRequest } from "fastify";
import { getMariaConnection } from "../../service/mariadb";
import { Trade, TradeItem } from "../../types/Endpoints";
import smartQuery from "../../utilities/smartQuery";

export default async function (request: FastifyRequest<{ Params: { user_ids: string } }>): Promise<[number, any]> {
	const connection = await getMariaConnection();
	if (!connection) {
		return [500, { error: "Failed to connect to the database" }];
	}

	try {
		const { user_ids } = request.params;
		const user_ids_array = user_ids
			.split(",")
			.map((id) => parseInt(id.trim(), 10))
			.filter((id) => !Number.isNaN(id));

		if (!user_ids_array.length) {
			return [400, { error: "No valid user IDs provided" }];
		}

		const trades = await smartQuery<Trade[]>(
			connection,
			`SELECT * FROM trades WHERE (initiator_user_id IN (?) OR receiver_user_id IN (?))  AND updated_at >= NOW() - INTERVAL 2 WEEK;`,
			[user_ids_array, user_ids_array],
		);

		const trade_ids = trades.map((trade) => trade.trade_id);
		let trade_items: TradeItem[] = [];
		if (trade_ids.length > 0) {
			trade_items = await smartQuery<TradeItem[]>(
				connection,
				`SELECT * FROM trade_items WHERE trade_id IN (?);`,
				[trade_ids],
			);
		}

		let trade_items_map: Record<number, TradeItem[]> = {};
		trades.forEach((trade) => {
			trade_items_map[trade.trade_id] = trade_items.filter((item) => item.trade_id === trade.trade_id);
		});

		const formatted_trades = trades.map((trade) => {
			return {
				trade_id: trade.trade_id,
				initiator: {
					user_id: trade.initiator_user_id,
					items: trade_items_map[trade.trade_id]
						.filter((item) => item.user_id === trade.initiator_user_id)
						.map((item) => item.item_uaid),
				},
				receiver: {
					user_id: trade.receiver_user_id,
					items: trade_items_map[trade.trade_id]
						.filter((item) => item.user_id === trade.receiver_user_id)
						.map((item) => item.item_uaid),
				},
				status: trade.status,
				created_at: trade.created_at,
				updated_at: trade.updated_at,
				transfer_id: trade.transfer_id,
			};
		});

		return [200, { status: "OK", trades: formatted_trades }];
	} catch (error) {
		console.error(error);
		return [500, { error: "Internal Server Error" }];
	} finally {
		connection.release();
	}
}
