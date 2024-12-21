import { getMariaConnection } from "../../service/mariadb";
import getItemString from "../../utilities/getItemString";
import query from "../../utilities/smartQuery";

export default async function (): Promise<[number, any]> {
	const connection = await getMariaConnection();

	if (!connection) {
		return [500, { error: "Failed to connect to the database" }];
	}

	try {
		const coinflips = await query(connection, "SELECT * FROM coinflips WHERE status != 'completed'");
		let corrected_coinflips = coinflips.map(async (coinflip: any) => {
			const player1_item_string = await getItemString(connection, coinflip.player1_items.split(","));
			const player2_item_string = await getItemString(connection, coinflip.player2_items.split(","));

			return {
				...coinflip,
				player1_items: player1_item_string,
				player2_items: player2_item_string,
			};
		});

		return [200, await Promise.all(corrected_coinflips)];
	} catch (error) {
		return [500, { error: "Failed to get coinflips" }];
	} finally {
		connection.release();
	}
}
