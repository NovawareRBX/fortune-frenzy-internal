import { FastifyRequest } from "fastify";
import { getMariaConnection } from "../../service/mariadb";
import { ItemListing } from "../../types/Endpoints";
import smartQuery from "../../utilities/smartQuery";

export default async function (
	request: FastifyRequest<{
		Body: {
			network: string;
			networkData: {
				name: string;
				globalName: string;
				eventType: "Event" | "Function";
			};
			incorrectArg: {
				index?: number;
				value: string;
			};
			player: number;
		};
	}>,
): Promise<[number, any]> {
	const connection = await getMariaConnection();
	if (!connection) {
		return [500, { error: "Failed to connect to the database" }];
	}

	// log into the database
	const [result] = await smartQuery(
		connection,
		"INSERT INTO roblox_network_logs (error_type, nwi_name, nwi_globalName, nwi_eventType, incorrectArg_index, incorrectArg_value, playerId) VALUES (?, ?, ?, ?, ?, ?, ?)",
		[
			request.body.network,
			request.body.networkData.name,
			request.body.networkData.globalName,
			request.body.networkData.eventType,
			request.body.incorrectArg.index,
			request.body.incorrectArg.value,
			request.body.player,
		],
	);

	if (result.affectedRows === 0) {
		return [500, { error: "Failed to log into the database" }];
	}

	return [200, { status: "OK", id: result.insertId }];
}
