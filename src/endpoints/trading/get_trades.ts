import { FastifyRequest } from "fastify";
import { getMariaConnection } from "../../service/mariadb";
import { Trade, TradeItem } from "../../types/Endpoints";
import smartQuery from "../../utilities/smartQuery";
import getUserInfo from "../../utilities/getUserInfo";
import getItemString from "../../utilities/getItemString";
// assuming getItemString can handle an array of UAIDs and return a map or something similar

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

		// 1) Fetch relevant trades
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

		// 2) Fetch trade_items for these trades
		const tradeIds = trades.map((t) => t.trade_id);
		const tradeItems = await smartQuery<TradeItem[]>(
			connection,
			`SELECT * FROM trade_items WHERE trade_id IN (?)`,
			[tradeIds],
		);

		// 3) Collect all UAIDs in one array (or set)
		const allUaids = Array.from(new Set(tradeItems.map((t) => t.item_uaid)));

		// 4) Call getItemString ONCE with the entire array
		//    NOTE: This *depends on your getItemString's return type.*
		//    If it returns a single string, that's a problem.
		//    We need it to return a map or array so we can
		//    distinguish the string for each UAID.
		//
		//    Let's assume getItemString(...) returns a map like:
		//    { [uaid: number]: string }
		//    Adjust accordingly if your function returns a different shape.
		//
		const itemStringsMap = await getItemString(connection, allUaids);

		// 5) Gather user info for initiator/receiver
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

		// 6) Group tradeItems by trade_id
		const tradeItemsMap = tradeItems.reduce<Record<number, TradeItem[]>>((acc, item) => {
			acc[item.trade_id] = acc[item.trade_id] || [];
			acc[item.trade_id].push(item);
			return acc;
		}, {});

		// 7) Format the final response, referencing `itemStringsMap`
		//    to get the item string for each item_uaid
		const formattedTrades = trades.map((trade) => {
			const itemsForThisTrade = tradeItemsMap[trade.trade_id] || [];
			const initiatorItems = itemsForThisTrade.filter((it) => it.user_id === trade.initiator_user_id);
			const receiverItems = itemsForThisTrade.filter((it) => it.user_id === trade.receiver_user_id);

			// Build item strings from the map
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
