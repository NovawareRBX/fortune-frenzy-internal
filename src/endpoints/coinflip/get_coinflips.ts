import { FastifyRequest } from "fastify";
import { getMariaConnection } from "../../service/mariadb";
import getItemString from "../../utilities/getItemString";
import getUserInfo from "../../utilities/getUserInfo";
import query from "../../utilities/smartQuery";

export default async function (
	request: FastifyRequest<{
		Querystring: { server_id?: string };
	}>,
): Promise<[number, any]> {
	const connection = await getMariaConnection();
	if (!connection) {
		return [500, { error: "Failed to connect to the database" }];
	}

	try {
		const { server_id } = request.query;
		let db_query = `
      SELECT
        id,
        player1,
        player2,
        player1_items,
        player2_items,
        status,
        type,
        server_id,
        player1_coin,
        winning_coin
      FROM coinflips
      WHERE status != 'completed'
    `;
		const params: Array<string> = [];
		if (server_id) {
			db_query += ` AND (type = 'global' OR (type = 'server' AND server_id = ?))`;
			params.push(server_id);
		}

		const coinflips = await query<
			Array<{
				id: string;
				player1: string;
				player2: string | null;
				player1_items: string;
				player2_items: string | null;
				status: string;
				type: string;
				server_id: string;
				player1_coin: 1 | 2;
				winning_coin: 1 | 2 | null;
			}>
		>(connection, db_query, params);

		if (coinflips.length === 0) {
			return [200, { status: "OK", coinflips: [] }];
		}

		const all_player_ids = Array.from(
			new Set(coinflips.flatMap(({ player1, player2 }) => [player1, player2].filter(Boolean))),
		);

		const user_info = await getUserInfo(
			connection,
			all_player_ids.filter((id): id is string => id !== null),
		);
		const user_map = new Map(
			user_info.map((user) => [
				user.id,
				{ id: user.id, username: user.username, display_name: user.display_name },
			]),
		);

		const all_item_ids = Array.from(
			new Set(
				coinflips.flatMap(({ player1_items, player2_items }) => [
					...player1_items.split(","),
					...(player2_items?.split(",") || []),
				]),
			),
		);

		const item_strings = await getItemString(connection, all_item_ids);
		const item_map = new Map(
			item_strings.map((str) => {
				const [key, value] = str.split(":");
				return [key, value] as [string, string];
			}),
		);

		const corrected_coinflips = coinflips.map((coinflip) => ({
			...coinflip,
			player1: user_map.get(coinflip.player1) || {
				id: coinflip.player1,
				username: null,
				display_name: null,
			},
			player2: coinflip.player2
				? user_map.get(coinflip.player2) || {
						id: coinflip.player2,
						username: null,
						display_name: null,
				  }
				: null,
			player1_items: coinflip.player1_items.split(",").map((id) => `${id}:${item_map.get(id)}`),
			player2_items: coinflip.player2_items
				? coinflip.player2_items.split(",").map((id) => `${id}:${item_map.get(id)}`)
				: null,
		}));

		return [200, { status: "OK", coinflips: corrected_coinflips }];
	} catch (error) {
		console.error(error);
		return [500, { error: "Failed to get coinflips" }];
	} finally {
		connection.release();
	}
}
