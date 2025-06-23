import { FastifyRequest } from "fastify";
import { getPostgresConnection } from "../../service/postgres";
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
		const connection = await getPostgresConnection();
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
			const result = await connection.query(
				"INSERT INTO roblox_network_logs (error_type, nwi_name, nwi_globalName, nwi_eventType, incorrectArg_index, incorrectArg_value, playerId) VALUES ($1, $2, $3, $4, $5, $6, $7)",
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

			if (result.rowCount === 0) {
				return [500, { error: "Failed to log into the database" }];
			}

			return [200, { status: "OK", id: result.rows[0].id }];
		} finally {
			await connection.release();
		}
	}
};
