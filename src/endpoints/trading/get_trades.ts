import { FastifyRequest } from "fastify";
import { getMariaConnection } from "../../service/mariadb";
import { Trade, TradeItem } from "../../types/Endpoints";
import smartQuery from "../../utilities/smartQuery";
import getUserInfo from "../../utilities/getUserInfo";
import getItemString from "../../utilities/getItemString";

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
			`SELECT * FROM trades
	   WHERE (initiator_user_id IN (?) OR receiver_user_id IN (?))
		 AND updated_at >= NOW() - INTERVAL 2 WEEK;`,
			[user_ids_array, user_ids_array],
		);

		if (trades.length === 0) {
			return [200, { status: "OK", trades: [] }];
		}

		const tradeIds = trades.map((t) => t.trade_id);
		const tradeItems = await smartQuery<TradeItem[]>(
			connection,
			`SELECT * FROM trade_items WHERE trade_id IN (?)`,
			[tradeIds],
		);

		const allUaids = Array.from(new Set(tradeItems.map((t) => t.item_uaid)));
		const itemStringsMap = await getItemString(connection, allUaids);

		const relevantUserIds = new Set<string>();
		for (const trade of trades) {
			relevantUserIds.add(trade.initiator_user_id);
			relevantUserIds.add(trade.receiver_user_id);
		}

		const userInfoRecords = await getUserInfo(
			connection,
			Array.from(relevantUserIds).map((id) => id.toString()),
		);

		const userInfoMap = userInfoRecords.reduce<Record<string, { username: string; display_name: string }>>(
			(acc, { id, username, display_name }) => {
				acc[id] = {
					username: username ?? "",
					display_name: display_name ?? "",
				};
				return acc;
			},
			{},
		);

		const UNKNOWN = "Unknown";
		const getSafeUserInfo = (userId: string) => {
			return (
				userInfoMap[userId] || {
					username: UNKNOWN,
					display_name: UNKNOWN,
				}
			);
		};

		const tradeItemsMap = tradeItems.reduce<Record<number, TradeItem[]>>((acc, item) => {
			acc[item.trade_id] = acc[item.trade_id] || [];
			acc[item.trade_id].push(item);
			return acc;
		}, {});

		const formattedTrades = trades.map((trade) => {
			const itemsForThisTrade = tradeItemsMap[trade.trade_id] || [];
			const initiatorItems = itemsForThisTrade.filter((it) => it.user_id === trade.initiator_user_id);
			const receiverItems = itemsForThisTrade.filter((it) => it.user_id === trade.receiver_user_id);

			const initiatorItemsString = initiatorItems.map(
				(it) => itemStringsMap.find((item) => item.split(":")[0] === it.item_uaid) || "N/A",
			);
			const receiverItemsString = receiverItems.map(
				(it) => itemStringsMap.find((item) => item.split(":")[0] === it.item_uaid) || "N/A",
			);

			const initiatorInfo = getSafeUserInfo(trade.initiator_user_id);
			const receiverInfo = getSafeUserInfo(trade.receiver_user_id);

			return {
				trade_id: trade.trade_id,
				initiator: {
					user_id: trade.initiator_user_id,
					username: initiatorInfo.username,
					display_name: initiatorInfo.display_name,
					items: initiatorItemsString,
				},
				receiver: {
					user_id: trade.receiver_user_id,
					username: receiverInfo.username,
					display_name: receiverInfo.display_name,
					items: receiverItemsString,
				},
				status: trade.status,
				created_at: new Date(trade.created_at),
				updated_at: new Date(trade.updated_at),
				transfer_id: trade.transfer_id,
			};
		});

		return [200, { status: "OK", trades: formattedTrades }];
	} catch (error) {
		console.error(error);
		return [500, { error: "Internal Server Error" }];
	} finally {
		connection.release();
	}
}
