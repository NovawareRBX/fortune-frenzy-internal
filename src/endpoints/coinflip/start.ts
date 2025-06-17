import { FastifyRequest } from "fastify";
import { randomCoinflip } from "../../utilities/secureRandomness";
import { getRedisConnection } from "../../service/redis";
import getTotalValue from "../../utilities/getTotalValue";
import { CoinflipData } from "./create";
import doSelfHttpRequest from "../../utilities/internalRequest";
import { getMariaConnection } from "../../service/mariadb";
import { CoinflipRedisManager } from "../../service/coinflip-redis";
import { z } from "zod";

const startParamsSchema = z.object({
	coinflip_id: z.string(),
});

export default {
	method: "POST",
	url: "/coinflip/start/:coinflip_id",
	authType: "key",
	callback: async function(
		request: FastifyRequest<{
			Params: { coinflip_id: string };
		}>,
	): Promise<[number, any]> {
		const paramsParse = startParamsSchema.safeParse(request.params);
		if (!paramsParse.success) {
			return [400, { error: "Invalid request", errors: paramsParse.error.flatten() }];
		}
		const { coinflip_id: id } = paramsParse.data;

		const redis = await getRedisConnection();
		const maria = await getMariaConnection();

		if (!id) {
			return [400, { error: "Invalid request" }];
		}

		if (!redis || !maria) {
			return [500, { error: "Internal Server Error" }];
		}

		const coinflipManager = new CoinflipRedisManager(redis, request.server);
		const MAX_RETRIES = 3;
		const RETRY_DELAY = 100;

		for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
			try {
				// Acquire lock for starting the coinflip
				const lockKey = `coinflip:start:lock:${id}`;
				const lockAcquired = await redis.set(lockKey, '1', { 
					NX: true,
					EX: 30 // 30 second lock expiry
				});

				if (!lockAcquired) {
					await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
					continue;
				}

				const coinflip = await coinflipManager.getCoinflip(id);
				if (!coinflip) {
					await redis.del(lockKey);
					return [404, { error: "Coinflip not found" }];
				}

				if (coinflip.status !== "awaiting_confirmation" || !coinflip.player2 || !coinflip.player2_items) {
					await redis.del(lockKey);
					return [400, { error: "Coinflip cannot be started" }];
				}

				// Store initial state for potential rollback
				const initialState = { ...coinflip };

				try {
					const response = await doSelfHttpRequest(request.server, {
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
						throw new Error("Item transfer failed");
					}

					const body = JSON.parse(response.body);
					const player1_value = await getTotalValue(coinflip.player1_items);
					const player2_value = await getTotalValue(coinflip.player2_items);
					const winning_player = randomCoinflip(
						[coinflip.player1.id, coinflip.player2.id],
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

					// Store in MariaDB first before completing in Redis
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

					await coinflipManager.completeCoinflip(id, coinflip);

					// Confirm transfer to winner
					const confirmResponse = await doSelfHttpRequest(request.server, {
						method: "POST",
						url: `/items/item-transfer/${body.transfer_id}/confirm`,
						body: {
							user_id: winning_player.result === 1 ? coinflip.player1.id : coinflip.player2.id,
						},
					});

					if (confirmResponse.statusCode !== 200) {
						throw new Error("Transfer confirmation failed");
					}

					await redis.del(lockKey);

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
					// Rollback attempt
					try {
						// If transfer_id exists, try to cancel the transfer
						if (coinflip.transfer_id) {
							await doSelfHttpRequest(request.server, {
								method: "POST",
								url: `/items/item-transfer/${coinflip.transfer_id}/cancel`,
								body: {
									reason: "Coinflip failed - automatic rollback"
								},
							});
						}

						// Restore initial state
						initialState.status = "failed";
						await coinflipManager.completeCoinflip(id, initialState);
					} catch (rollbackError) {}
					
					await redis.del(lockKey);
					return [500, { error: "Internal Server Error", details: "Transaction failed and was rolled back" }];
				}

			} catch (error) {
				console.error("Failed to process coinflip:", error);
				return [500, { error: "Internal Server Error" }];
			}
		}

		return [500, { error: "Failed to acquire lock after maximum retries" }];
	}
};
