import { FastifyRequest } from "fastify";
import { getMariaConnection } from "../../service/mariadb";
import { Trade, TradeItem } from "../../types/Endpoints";
import smartQuery from "../../utilities/smartQuery";
import getUserInfo from "../../utilities/getUserInfo";

export default async function get_trades_by_user_ids(
	request: FastifyRequest<{ Params: { user_ids: string } }>,
): Promise<[number, any]> {
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

		if (user_ids_array.length === 0) {
			return [400, { error: "No valid user IDs provided" }];
		}

		const trades = await smartQuery<Trade[]>(
			connection,
			`SELECT * FROM trades WHERE (initiator_user_id IN (?) OR receiver_user_id IN (?)) AND updated_at >= NOW() - INTERVAL 2 WEEK;`,
			[user_ids_array, user_ids_array],
		);

		if (trades.length === 0) {
			return [200, { status: "OK", trades: [] }];
		}

		const trade_ids = trades.map((trade) => trade.trade_id);
		let trade_items: TradeItem[] = [];
		if (trade_ids.length > 0) {
			trade_items = await smartQuery<TradeItem[]>(connection, `SELECT * FROM trade_items WHERE trade_id IN (?)`, [
				trade_ids,
			]);
		}

		const trade_items_map = trade_items.reduce<Record<number, TradeItem[]>>((acc, item) => {
			acc[item.trade_id] = acc[item.trade_id] || [];
			acc[item.trade_id].push(item);
			return acc;
		}, {});

		const relevant_user_ids = new Set<string>();
		for (const trade of trades) {
			relevant_user_ids.add(trade.initiator_user_id.toString());
			relevant_user_ids.add(trade.receiver_user_id.toString());
		}

		const relevant_user_ids_array = Array.from(relevant_user_ids);
		const user_infos = await getUserInfo(
			connection,
			relevant_user_ids_array.map((id) => id.toString()),
		);

		const user_info_map = user_infos.reduce<
			Record<
				string,
				Omit<
					{
						id: number;
						username: string;
						display_name: string;
					},
					"id"
				>
			>
		>((acc, { id, username, display_name }) => {
			acc[id] = { username: username ?? "", display_name: display_name ?? "" };
			return acc;
		}, {});

		const UNKNOWN = "Unknown";
		const formatted_trades = trades.map((trade) => {
			const items_for_this_trade = trade_items_map[trade.trade_id] || [];
			const initiator_items = items_for_this_trade.filter((item) => item.user_id === trade.initiator_user_id);
			const receiver_items = items_for_this_trade.filter((item) => item.user_id === trade.receiver_user_id);

			const initiator_info = user_info_map[trade.initiator_user_id.toString()] || {
				username: UNKNOWN,
				display_name: UNKNOWN,
			};
			const receiver_info = user_info_map[trade.receiver_user_id.toString()] || {
				username: UNKNOWN,
				display_name: UNKNOWN,
			};

			return {
				trade_id: trade.trade_id,
				initiator: {
					user_id: trade.initiator_user_id,
					username: initiator_info.username,
					display_name: initiator_info.display_name,
					items: initiator_items.map((item) => item.item_uaid),
				},
				receiver: {
					user_id: trade.receiver_user_id,
					username: receiver_info.username,
					display_name: receiver_info.display_name,
					items: receiver_items.map((item) => item.item_uaid),
				},
				status: trade.status,
				created_at: new Date(trade.created_at),
				updated_at: new Date(trade.updated_at),
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
