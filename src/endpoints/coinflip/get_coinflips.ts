import { getMariaConnection } from "../../service/mariadb";
import getItemString from "../../utilities/getItemString";
import query from "../../utilities/smartQuery";

export default async function (): Promise<[number, any]> {
	const connection = await getMariaConnection();
	if (!connection) return [500, { error: "Failed to connect to the database" }];

	try {
		const coinflips = await query<
			Array<{
				id: string;
				player1: string;
				player2: string;
				player1_items: string;
				player2_items: string | null;
				status: string;
				type: string;
				server_id: string;
				player1_coin: 1 | 2;
				winning_coin: 1 | 2 | null;
			}>
		>(connection, "SELECT * FROM coinflips WHERE status != 'completed'");

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
			player1_items: coinflip.player1_items
				.split(",")
				.map((id) => item_map.get(id))
				.join(", "),
			player2_items: coinflip.player2_items
				? coinflip.player2_items
						.split(",")
						.map((id) => item_map.get(id))
						.join(", ")
				: null,
		}));

		return [200, corrected_coinflips];
	} catch (error) {
		console.error(error);
		return [500, { error: "Failed to get coinflips" }];
	} finally {
		connection.release();
	}
}
