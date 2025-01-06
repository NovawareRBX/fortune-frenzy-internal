import { FastifyRequest } from "fastify";
import { getRedisConnection } from "../../service/redis";
import { getMariaConnection } from "../../service/mariadb";
import { CoinflipData } from "./create";
import discordLog from "../../utilities/discordLog";

export default async function (
	request: FastifyRequest<{
		Params: { coinflip_id: string };
	}>,
): Promise<[number, any]> {
	const { coinflip_id } = request.params;

	if (!coinflip_id || typeof coinflip_id !== "string" || coinflip_id.length < 1) {
		return [400, { error: "Invalid request" }];
	}

	const redis = await getRedisConnection();
	const connection = await getMariaConnection();

	if (!connection) {
		return [500, { error: "Failed to connect to the database" }];
	}

	try {
		const coinflip_data = await redis.get(`coinflip:${coinflip_id}`);

		if (!coinflip_data) {
			return [404, { error: "Coinflip not found" }];
		}

		const parsed_coinflip: CoinflipData = JSON.parse(coinflip_data);
		if (parsed_coinflip.status !== "waiting_for_player") {
			return [400, { error: "Coinflip cannot be canceled" }];
		}

		await redis
			.multi()
			.del(`coinflip:${coinflip_id}`)
			.del(`coinflip:${coinflip_id}:user:${parsed_coinflip.player1.id}`)
			.del(`coinflip:${coinflip_id}:user:${parsed_coinflip.player2?.id}`)
			.sRem(`coinflips:server:${parsed_coinflip.server_id}`, coinflip_id)
			.sRem("coinflips:global", coinflip_id)
			.exec();

		discordLog("Log", "Coinflip canceled", `Coinflip ${coinflip_id} has been cancelled`);

		return [200, { status: "OK", message: "Coinflip canceled successfully" }];
	} catch (error) {
		discordLog("Danger", "Failed to cancel coinflip", `Failed to cancel coinflip with error: ${error}`);

		return [500, { error: "Failed to cancel coinflip" }];
	} finally {
		connection.release();
	}
}
