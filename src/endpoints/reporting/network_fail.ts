import { FastifyRequest } from "fastify";
import { getMariaConnection } from "../../service/mariadb";
import { ItemListing } from "../../types/Endpoints";
import smartQuery from "../../utilities/smartQuery";
import { z } from "zod";

const networkFailSchema = z.object({
	network: z.string(),
	networkData: z.object({
		name: z.string(),
		globalName: z.string(),
		eventType: z.enum(["Event", "Function"]),
	}),
	incorrectArg: z.object({
		index: z.number().optional(),
		value: z.string(),
	}),
	player: z.number(),
});

export default {
	method: "POST",
	url: "/reporting/network_fail",
	authType: "key",
	callback: async function (
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

		try {
			const parseResult = networkFailSchema.safeParse(request.body);
			if (!parseResult.success) {
				return [400, { error: "Invalid request", errors: parseResult.error.flatten() }];
			}
			const body = parseResult.data;
			// log into the database
			const [result] = await smartQuery(
				connection,
				"INSERT INTO roblox_network_logs (error_type, nwi_name, nwi_globalName, nwi_eventType, incorrectArg_index, incorrectArg_value, playerId) VALUES (?, ?, ?, ?, ?, ?, ?)",
				[
					body.network,
					body.networkData.name,
					body.networkData.globalName,
					body.networkData.eventType,
					body.incorrectArg.index,
					body.incorrectArg.value,
					body.player,
				],
			);

			if (result.affectedRows === 0) {
				return [500, { error: "Failed to log into the database" }];
			}

			return [200, { status: "OK", id: result.insertId }];
		} finally {
			await connection.release();
		}
	}
};
