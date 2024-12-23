import { getMariaConnection } from "../../service/mariadb";
import getItemString from "../../utilities/getItemString";
import query from "../../utilities/smartQuery";

export default async function (): Promise<[number, any]> {
	const connection = await getMariaConnection();

	if (!connection) {
		return [500, { error: "Failed to connect to the database" }];
	}

	try {
		const coinflips = await query<
			Array<{
				id: string;
				player1: string;
				player2: string;
				player1_items: string;
				player2_items: string | null;
				status: "waiting_for_players" | "awaiting_confirmation" | "completed" | "failed";
				transfer_id: string | null;
				type: "server" | "global" | "friends";
				server_id: string;
				player1_coin: 1 | 2;
				winning_coin: 1 | 2 | null;
			}>
		>(connection, "SELECT * FROM coinflips WHERE status != 'completed'");
		let corrected_coinflips = coinflips.map(async (coinflip) => {
			const player1_item_string = await getItemString(connection, coinflip.player1_items.split(","));
			const player2_item_string = coinflip.player2_items
				? await getItemString(connection, coinflip.player2_items.split(","))
				: null;

			return {
				...coinflip,
				player1_items: player1_item_string,
				player2_items: player2_item_string,
			};
		});

		return [200, await Promise.all(corrected_coinflips)];
	} catch (error) {
		console.error(error);
		return [500, { error: "Failed to get coinflips" }];
	} finally {
		connection.release();
	}
}
