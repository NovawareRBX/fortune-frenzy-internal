import { Connection, PoolConnection } from "mariadb";
import { getMariaConnection } from "../../service/mariadb";
import { ItemCase } from "../../types/Endpoints";
import smartQuery from "../../utilities/smartQuery";

export default {
	method: "GET",
	url: "/cases",
	authType: "none",
	callback: async function(): Promise<[number, any]> {
		const connection = await getMariaConnection();
		if (!connection) {
			return [500, { error: "Failed to connect to the database" }];
		}

		try {
			const rows = await smartQuery<ItemCase>(connection, "SELECT * FROM cases");

			return [
				200,
				{
					status: "OK",
					data: rows,
				},
			];
		} catch (error) {
			console.error("Error fetching cases:", error);
			return [
				500,
				{
					error: "Internal Server Error",
				},
			];
		} finally {
			connection.release();
		}
	}
};
