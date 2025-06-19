import { getPostgresConnection } from "../../service/postgres";
import { ItemCase } from "../../types/Endpoints";

export default {
	method: "GET",
	url: "/cases",
	authType: "none",
	callback: async function(): Promise<[number, any]> {
		const connection = await getPostgresConnection();
		if (!connection) {
			return [500, { error: "Failed to connect to the database" }];
		}

		try {
			const { rows } = await connection.query("SELECT * FROM cases");

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
