import { getMariaConnection } from "../../service/mariadb";
import query from "../../utilities/smartQuery";

export default async function (): Promise<[number, any]> {
	const connection = await getMariaConnection();

	if (!connection) {
		return [500, { error: "Failed to connect to the database" }];
	}

	try {
		const coinflips = await query(connection, "SELECT * FROM coinflips WHERE status != 'completed'");
		return [200, { status: "OK", coinflips }];
	} catch (error) {
		return [500, { error: "Failed to get coinflips" }];
	} finally {
		connection.release();
	}
}
