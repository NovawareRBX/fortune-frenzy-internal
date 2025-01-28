import { FastifyRequest } from "fastify";
import { getMariaConnection } from "../../service/mariadb";
import smartQuery from "../../utilities/smartQuery";

const types: { [key: string]: string } = {
	cash: "current_cash",
};

export default async function (request: FastifyRequest<{ Params: { id: string } }>): Promise<[number, any]> {
	const connection = await getMariaConnection();
	const user_id = parseInt(request.params.id);
	if (isNaN(user_id)) return [400, { error: "Invalid user ID" }];
	if (!connection) return [500, { error: "Failed to connect to the database" }];

	try {
		const [data] = await smartQuery(connection, `SELECT * FROM users WHERE user_id = ?`, [user_id]);
		const recent_activity = await smartQuery(
			connection,
			`SELECT image, text FROM recent_game_activity WHERE user_id = ? ORDER BY created_at DESC LIMIT 10`,
			[user_id],
		);
		if (!data) return [404, { error: "User not found" }];

		return [
			200,
			{
				status: "OK",
				data: {
					data,
					recent_activity,
				},
			},
		];
	} catch (error) {
		console.error(error);
		return [500, { error: "Failed to get user count" }];
	} finally {
		connection.release();
	}
}
