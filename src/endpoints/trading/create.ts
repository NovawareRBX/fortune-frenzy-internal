import { FastifyRequest } from "fastify";
import { getMariaConnection } from "../../service/mariadb";
import { Trade, TradeItem } from "../../types/Endpoints";
import smartQuery from "../../utilities/smartQuery";
import doSelfHttpRequest from "../../utilities/doSelfHttpRequest";
import getUserInfo from "../../utilities/getUserInfo";
import getItemString from "../../utilities/getItemString";

export default async function (
	request: FastifyRequest<{
		Body: {
			initiator_id: string;
			receiver_id: string;
			initiator_items: string[];
			receiver_items: string[];
		};
	}>,
): Promise<[number, any]> {
	const connection = await getMariaConnection();
	if (!connection) {
		return [500, { error: "Failed to connect to the database" }];
	}

	try {
		// validate request body
		if (
			!request.body ||
			typeof request.body.initiator_id !== "string" ||
			typeof request.body.receiver_id !== "string" ||
			!Array.isArray(request.body.initiator_items) ||
			!Array.isArray(request.body.receiver_items) ||
			!request.body.initiator_items.every((item) => typeof item === "string" && item.startsWith("FF")) ||
			!request.body.receiver_items.every((item) => typeof item === "string" && item.startsWith("FF")) ||
			request.body.initiator_items.length === 0 ||
			request.body.receiver_items.length === 0
		) {
			return [400, { error: "Invalid request" }];
		}

		const { initiator_id, receiver_id, initiator_items, receiver_items } = request.body;
		const existing_trades = await smartQuery(
			connection,
			`
				SELECT t.trade_id, ti.item_uaid, t.initiator_user_id, t.receiver_user_id 
				FROM trades t
				JOIN trade_items ti ON t.trade_id = ti.trade_id
				WHERE t.initiator_user_id = ? AND t.receiver_user_id = ? AND t.status = 'pending'
    		`,
			[initiator_id, receiver_id],
		);


		const trade_items_map: Record<string, string[]> = {};
		for (const trade of existing_trades) {
			if (!trade_items_map[trade.trade_id]) {
				trade_items_map[trade.trade_id] = [];
			}
			trade_items_map[trade.trade_id].push(trade.item_uaid);
		}

		for (const [trade_id, items] of Object.entries(trade_items_map)) {
			const initiator_items_match =
				initiator_items.length === items.filter((item) => initiator_items.includes(item)).length;
			const receiver_items_match =
				receiver_items.length === items.filter((item) => receiver_items.includes(item)).length;

			if (initiator_items_match && receiver_items_match) {
				return [400, { error: `Duplicate trade detected with trade_id: ${trade_id}` }];
			}
		}

		const rows = await smartQuery<{ user_asset_id: string; owner_id: string }[]>(
			connection,
			"SELECT user_asset_id, owner_id FROM item_copies WHERE user_asset_id IN (?)",
			[initiator_items.concat(receiver_items)],
		);

		const initiator_items_owners = rows.filter(
			(row) => initiator_items.includes(row.user_asset_id) && row.owner_id === initiator_id,
		);
		const receiver_items_owners = rows.filter(
			(row) => receiver_items.includes(row.user_asset_id) && row.owner_id === receiver_id,
		);
		if (
			initiator_items_owners.length !== initiator_items.length ||
			receiver_items_owners.length !== receiver_items.length
		)
			return [400, { error: "Invalid items" }];

		const response = await doSelfHttpRequest(request, {
			method: "POST",
			url: "/items/item-transfer",
			body: [
				{
					user_id: initiator_id,
					items: initiator_items,
				},
				{
					user_id: receiver_id,
					items: receiver_items,
				},
			],
		});

		if (response.statusCode !== 200) return [500, { error: "Internal Server Error" }];
		const transfer_id = JSON.parse(response.body).transfer_id as string;

		await connection.beginTransaction();
		const [row] = await smartQuery(
			connection,
			"INSERT INTO trades (initiator_user_id, receiver_user_id, transfer_id) VALUES (?, ?, ?) RETURNING trade_id, status, created_at, updated_at",
			[initiator_id, receiver_id, transfer_id],
		);
		const trade_id = row.trade_id;
		const items: TradeItem[] = [
			...initiator_items.map((item) => ({ item_uaid: item, trade_id, user_id: initiator_id })),
			...receiver_items.map((item) => ({ item_uaid: item, trade_id, user_id: receiver_id })),
		];

		const values = items.map((item) => [item.item_uaid, item.trade_id, item.user_id]);
		await smartQuery(
			connection,
			`INSERT INTO trade_items (item_uaid, trade_id, user_id) VALUES ${values.map(() => "(?, ?, ?)").join(", ")}`,
			values.flat(),
		);

		const relevant_user_ids_array = [initiator_id, receiver_id];
		const user_info_map = (await getUserInfo(connection, relevant_user_ids_array)).reduce<
			Record<
				string,
				{
					username: string;
					display_name: string;
				}
			>
		>((acc, { id, username, display_name }) => {
			acc[id] = { username: username ?? "", display_name: display_name ?? "" };
			return acc;
		}, {});

		const initiator_items_string = await getItemString(connection, initiator_items);
		const receiver_items_string = await getItemString(connection, receiver_items);

		await connection.commit();
		return [
			200,
			{
				status: "OK",
				data: {
					trade_id,
					initiator: {
						user_id: initiator_id,
						username: user_info_map[initiator_id].username,
						display_name: user_info_map[initiator_id].display_name,
						items: initiator_items_string,
					},
					receiver: {
						user_id: receiver_id,
						username: user_info_map[receiver_id].username,
						display_name: user_info_map[receiver_id].display_name,
						items: receiver_items_string,
					},
					status: row.status,
					created_at: row.created_at,
					updated_at: row.updated_at,
					transfer_id,
				},
			},
		];
	} catch (error) {
		console.error(error);
		await connection.rollback();
		return [500, { error: "Internal Server Error" }];
	} finally {
		connection.release();
	}
}
