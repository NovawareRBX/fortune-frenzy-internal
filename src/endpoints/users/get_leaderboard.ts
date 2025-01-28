import { FastifyRequest } from "fastify";
import { getMariaConnection } from "../../service/mariadb";
import smartQuery from "../../utilities/smartQuery";

const types: { [key: string]: string } = {
	cash: "current_cash",
};

export default async function (
	request: FastifyRequest<{ Params: { type: string }; Querystring: { limit?: string } }>,
): Promise<[number, any]> {
	const limit = parseInt(request.query.limit || "100");
	const type = types[request.params.type];

	if (!type) return [400, { error: `Invalid leaderboard type, must be one of: ${Object.keys(types).join(", ")}` }];
	if (isNaN(limit) || limit < 5 || limit > 200) return [400, { error: "Limit must be a number between 5 and 200" }];

	const connection = await getMariaConnection();
	if (!connection) return [500, { error: "Failed to connect to the database" }];

	try {
		const rows = await smartQuery(
			connection,
			`SELECT user_id, name, display_name, current_cash FROM users ORDER BY ${type} DESC LIMIT ?`,
			[limit],
		);

		return [200, { leaderboard: rows }];
	} catch (error) {
		console.error(error);
		return [500, { error: "Failed to get user count" }];
	} finally {
		connection.release();
	}
}
