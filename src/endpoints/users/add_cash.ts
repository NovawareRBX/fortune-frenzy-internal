import { FastifyReply, FastifyRequest } from "fastify";
import { getMariaConnection } from "../../service/mariadb";
import discordLog from "../../utilities/discordLog";

export default async function (request: FastifyRequest<{ Params: { id: string } }>): Promise<[number, any]> {
	const connection = await getMariaConnection();
	if (!connection) {
		return [500, { error: "Failed to connect to the database" }];
	}

	try {
		const amount = parseInt(request.headers.amount as string);
		const id = request.params.id;
		if (isNaN(amount)) {
			return [400, { error: "Invalid amount" }];
		}

		const query = `INSERT INTO external_cash_change_requests (user_id, amount, status) VALUES (?, ?, 'pending');`;
		await connection.query(query, [id, amount]);

		discordLog("Log", "Added Cash", `Added cash to \`USER_${id}\` with amount ${amount}`);

		return [200, { status: "OK" }];
	} catch (error) {
		discordLog(
			"Warning",
			"Failed to add cash",
			`Failed to add cash to user ${request.params.id} with error: ${error}`,
		);

		console.error("Error fetching user inventory:", error);
		return [500, { error: "Internal Server Error" }];
	} finally {
		await connection.release();
	}
}
