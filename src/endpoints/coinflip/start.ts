import { FastifyRequest } from "fastify";
import secureFlip from "../../utilities/secureFlip";
import { getRedisConnection } from "../../service/redis";
import getTotalValue from "../../utilities/getTotalValue";
import { CoinflipData } from "./create";
import doSelfHttpRequest from "../../utilities/doSelfHttpRequest";
import { getMariaConnection } from "../../service/mariadb";
import discordLog from "../../utilities/discordLog";

export default async function (
	request: FastifyRequest<{
		Params: { coinflip_id: string };
	}>,
): Promise<[number, any]> {
	if (!request.params.coinflip_id || typeof request.params.coinflip_id !== "string") {
		return [400, { error: "Invalid request" }];
	}

	const id = request.params.coinflip_id;
	const redis = await getRedisConnection();
	const maria = await getMariaConnection();

	if (!id) {
		return [400, { error: "Invalid request" }];
	}

	if (!redis || !maria) {
		return [500, { error: "Internal Server Error" }];
	}

	try {
		const coinflipRaw = await redis.get(`coinflip:${id}`);
		if (!coinflipRaw) {
			return [404, { error: "Coinflip not found" }];
		}

		const coinflip: CoinflipData = JSON.parse(coinflipRaw);
		if (coinflip.status !== "awaiting_confirmation" || !coinflip.player2 || !coinflip.player2_items) {
			return [400, { error: "Coinflip cannot be started" }];
		}

		const response = await doSelfHttpRequest(request, {
			method: "POST",
			url: "/items/item-transfer",
			body: [
				{
					user_id: coinflip.player1.id,
					items: coinflip.player1_items.map((item: string) => item.split(":")[0]),
				},
				{
					user_id: coinflip.player2.id,
					items: coinflip.player2_items.map((item: string) => item.split(":")[0]),
				},
			],
		});

		if (response.statusCode !== 200) {
			coinflip.status = "failed";
			await redis.set(`coinflip:${id}`, JSON.stringify(coinflip), { EX: 10 });
			return [500, { error: "Item transfer failed" }];
		}

		const body = JSON.parse(response.body);
		const player1_value = await getTotalValue(coinflip.player1_items);
		const player2_value = await getTotalValue(coinflip.player2_items);
		const winning_player = secureFlip(
			[coinflip.player1.id.toString(), coinflip.player2.id.toString()],
			(player1_value / (player1_value + player2_value)) * 100,
			(player2_value / (player1_value + player2_value)) * 100,
		);
		if (winning_player.result === 1) {
			coinflip.winning_coin = coinflip.player1_coin;
		} else {
			coinflip.winning_coin = coinflip.player1_coin === 1 ? 2 : 1;
		}

		coinflip.status = "completed";
		coinflip.transfer_id = body.transfer_id;
		await redis.set(`coinflip:${id}`, JSON.stringify(coinflip), { EX: 40 });
		await redis.del(`coinflip:${id}:user:${coinflip.player1.id}`);
		await redis.del(`coinflip:${id}:user:${coinflip.player2.id}`);
		// await redis.sRem(`coinflips:global`, id);
		// await redis.sRem(`coinflips:server:${coinflip.server_id}`, id);

		doSelfHttpRequest(request, {
			method: "POST",
			url: `/items/item-transfer/${body.transfer_id}/confirm`,
			body: {
				user_id: winning_player.result === 1 ? coinflip.player1.id : coinflip.player2.id,
			},
		});

		await maria.query(
			"INSERT INTO past_coinflips (id, player1_id, player2_id, player1_items, player2_items, status, type, server_id, player1_coin, winning_coin, transfer_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
			[
				id,
				coinflip.player1.id,
				coinflip.player2.id,
				coinflip.player1_items.map((item: string) => item.split(":")[0]).join(","),
				coinflip.player2_items.map((item: string) => item.split(":")[0]).join(","),
				coinflip.status,
				coinflip.type,
				coinflip.server_id,
				coinflip.player1_coin,
				coinflip.winning_coin,
				coinflip.transfer_id,
			],
		);

		const [auto_id] = await maria.query("SELECT auto_id FROM past_coinflips WHERE id = ?", [id]);
		coinflip.auto_id = auto_id.auto_id;

		await redis.set(`coinflip:${id}`, JSON.stringify(coinflip), { EX: 40 });

		discordLog("Log", "Coinflip Completed", `Coinflip ${id} has been completed`);

		return [
			200,
			{
				status: "OK",
				data: {
					...coinflip,
				},
			},
		];
	} catch (error) {
		discordLog("EmergencyWakeTheFuckUpNow", "Failed to start coinflip", `Failed to process coinflip ${id} with error: ${error}`);
		console.error("Failed to process coinflip:", error);
		return [500, { error: "Internal Server Error" }];
	}
}
