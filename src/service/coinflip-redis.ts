import { RedisClientType } from "redis";
import { FastifyInstance } from "fastify";
import { CoinflipData } from "../endpoints/coinflip/create";
import doSelfHttpRequest from "../utilities/internalRequest";
import { getClickhouseConnection } from "./clickhouse";
import getTotalValue from "../utilities/getTotalValue";

const COINFLIP_EXPIRY = 3600;
const LOCK_EXPIRY = 30;

export class CoinflipRedisManager {
	private redis: RedisClientType;
	private server: FastifyInstance;

	constructor(redis: RedisClientType, server: FastifyInstance) {
		this.redis = redis;
		this.server = server;
	}

	private getKey(type: string, id: string): string {
		return `coinflip:${type}:${id}`;
	}

	/**
	 * No-op delay kept for interface compatibility – one-shot timers are disallowed.
	 */
	private async delay(): Promise<void> {
		return Promise.resolve();
	}

	private async hasActiveCoinflip(userId: string): Promise<boolean> {
		const userKey = this.getKey("user", userId);
		const existingId = await this.redis.get(userKey);
		if (!existingId) return false;

		const existingGameRaw = await this.redis.get(this.getKey("game", existingId));
		if (!existingGameRaw) {
			await this.redis.del(userKey);
			return false;
		}

		try {
			const existingGame: CoinflipData = JSON.parse(existingGameRaw);
			const inactive = existingGame.status === "completed" || existingGame.status === "failed";
			if (inactive) {
				await this.redis.del(userKey);
				return false;
			}
			return true;
		} catch {
			await this.redis.del(userKey);
			return false;
		}
	}

	async createCoinflip(data: CoinflipData): Promise<boolean> {
		const playerIdStr = data.player1.id.toString();

		if (await this.hasActiveCoinflip(playerIdStr)) {
			return false;
		}

		const lockKey = this.getKey("lock", playerIdStr);
		const coinflipKey = this.getKey("game", data.id);
		const userKey = this.getKey("user", playerIdStr);

		const result = await this.redis
			.multi()
			.set(lockKey, "1", { NX: true, EX: LOCK_EXPIRY })
			.set(coinflipKey, JSON.stringify(data), { NX: true, EX: COINFLIP_EXPIRY })
			.sAdd(this.getKey("server", data.server_id), data.id)
			.sAdd("coinflips:global", data.id)
			.set(userKey, data.id, { NX: true, EX: COINFLIP_EXPIRY })
			.exec();

		if (!result || result.some((reply) => !reply)) {
			await this.redis.del([lockKey, coinflipKey, userKey]);
			return false;
		}

		const clickhouse = await getClickhouseConnection();
		try {
			clickhouse.insert({
				table: "coinflip_events",
				format: "JSONEachRow",
				values: [
					{
						event_id: crypto.randomUUID(),
						coinflip_id: data.id,
						user_id: data.player1.id,
						event_type: "created",
						created_at: new Date().toISOString().slice(0, 19).replace("T", " "),
						data: {
							player1_items: data.player1_items,
							player2_items: [],
							player1_coin: data.player1_coin,
							player1_value: getTotalValue(data.player1_items),
							player2_value: 0,
							server_id: data.server_id,
							winner: data.winning_coin,
						},
					},
				],
			});
		} catch (_) {}

		return true;
	}

	async joinCoinflip(coinflipId: string, userId: number, updatedData: CoinflipData): Promise<boolean> {
		const MAX_RETRIES = 3;

		const playerIdStr = userId.toString();
		const gameKey = this.getKey("game", coinflipId);
		const userKey = this.getKey("user", playerIdStr);

		for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
			if (await this.hasActiveCoinflip(playerIdStr)) {
				return false;
			}

			try {
				await this.redis.watch(gameKey);

				const currentGame = await this.redis.get(gameKey);
				if (!currentGame) {
					await this.redis.unwatch();
					return false;
				}

				const current: CoinflipData = JSON.parse(currentGame);
				if (current.status !== "waiting_for_player") {
					await this.redis.unwatch();
					return false;
				}

				const result = await this.redis
					.multi()
					.set(gameKey, JSON.stringify(updatedData), { XX: true, EX: COINFLIP_EXPIRY })
					.set(userKey, coinflipId, { NX: true, EX: COINFLIP_EXPIRY })
					.exec();

				if (result && !result.some((reply) => !reply)) {
					try {
						const clickhouse = await getClickhouseConnection();
						clickhouse.insert({
							table: "coinflip_events",
							format: "JSONEachRow",
							values: [
								{
									event_id: crypto.randomUUID(),
									coinflip_id: coinflipId,
									user_id: userId,
									event_type: "joined",
									created_at: new Date().toISOString().slice(0, 19).replace("T", " "),
									data: {
										player1_items: current.player1_items,
										player2_items: updatedData.player2_items,
										player1_coin: current.player1_coin,
										player1_value: getTotalValue(current.player1_items),
										player2_value: getTotalValue(updatedData.player2_items || []),
										server_id: current.server_id,
									},
								},
							],
						});
					} catch (_) {}

					return true;
				}

				console.log(`Coinflip join attempt ${attempt + 1} failed due to concurrent modification, retrying...`);
				await this.delay();
			} catch (error) {
				await this.redis.unwatch();
				throw error;
			}
		}

		console.log(`Failed to join coinflip ${coinflipId} after ${MAX_RETRIES} attempts`);
		return false;
	}

	async getCoinflip(id: string): Promise<CoinflipData | null> {
		const data = await this.redis.get(this.getKey("game", id));
		return data ? JSON.parse(data) : null;
	}

	async getActiveCoinflips(serverId?: string): Promise<string[]> {
		if (serverId) {
			return this.redis.sInter(["coinflips:global", this.getKey("server", serverId)]);
		}
		return this.redis.sMembers("coinflips:global");
	}

	async cancelCoinflip(id: string, data: CoinflipData): Promise<boolean> {
		const gameKey = this.getKey("game", id);
		const player1Key = this.getKey("user", data.player1.id.toString());
		const player2Key = data.player2 ? this.getKey("user", data.player2.id.toString()) : null;
		const serverKey = this.getKey("server", data.server_id);

		const multi = this.redis
			.multi()
			.del([gameKey])
			.del([player1Key])
			.sRem(serverKey, id)
			.sRem("coinflips:global", id);

		if (player2Key) {
			multi.del([player2Key]);
		}

		try {
			const clickhouse = await getClickhouseConnection();
			clickhouse.insert({
				table: "coinflip_events",
				format: "JSONEachRow",
				values: [
					{
						event_id: crypto.randomUUID(),
						coinflip_id: id,
						user_id: data.player1.id,
						event_type: "cancelled",
						created_at: new Date().toISOString().slice(0, 19).replace("T", " "),
						data: {
							player1_items: data.player1_items,
							player2_items: data.player2_items,
							player1_coin: data.player1_coin,
							player1_value: getTotalValue(data.player1_items),
							player2_value: getTotalValue(data.player2_items || []),
							server_id: data.server_id,
							winner: data.winning_coin,
						},
					},
				],
			});
		} catch (_) {}

		const result = await multi.exec();
		return result !== null;
	}

	async completeCoinflip(id: string, finalData: CoinflipData): Promise<boolean> {
		const gameKey = this.getKey("game", id);
		const player1Key = this.getKey("user", finalData.player1.id.toString());
		const player2Key = this.getKey("user", finalData.player2!.id.toString());

		const result = await this.redis
			.multi()
			.set(gameKey, JSON.stringify(finalData), { XX: true, EX: 300 })
			.del([player1Key])
			.del([player2Key])
			.sRem(this.getKey("server", finalData.server_id), id)
			.exec();

		if (result === null) {
			return false;
		}

		// Immediate global-set cleanup; periodic schedulers will also ensure consistency.
		try {
			await this.redis.sRem("coinflips:global", id);
		} catch (error) {
			console.error(`Failed to remove coinflip ${id} from global set:`, error);
		}

		try {
			const clickhouse = await getClickhouseConnection();
			clickhouse.insert({
				table: "coinflip_events",
				format: "JSONEachRow",
				values: [
					{
						event_id: crypto.randomUUID(),
						coinflip_id: id,
						user_id: finalData.player1.id,
						event_type: "completed",
						created_at: new Date().toISOString().slice(0, 19).replace("T", " "),
						data: {
							player1_items: finalData.player1_items,
							player2_items: finalData.player2_items,
							player1_coin: finalData.player1_coin,
							player1_value: getTotalValue(finalData.player1_items),
							player2_value: getTotalValue(finalData.player2_items || []),
							server_id: finalData.server_id,
							winner: finalData.winning_coin,
						},
					},
				],
			});
		} catch (_) {}

		return true;
	}

	async getUserActiveCoinflip(userId: string): Promise<string | null> {
		return this.redis.get(this.getKey("user", userId));
	}

	async cleanup(id: string, data: CoinflipData): Promise<void> {
		await this.cancelCoinflip(id, data);
	}

	async handleExpiredCoinflip(id: string, data: CoinflipData): Promise<void> {
		try {
			if (data.transfer_id && data.status === "awaiting_confirmation") {
				await this.cancelTransfer(data.transfer_id);
			}

			data.status = "failed";
			await this.completeCoinflip(id, data);
		} catch (error) {}
	}

	private async cancelTransfer(transferId: string): Promise<void> {
		try {
			const response = await doSelfHttpRequest(this.server, {
				method: "POST",
				url: `/items/item-transfer/${transferId}/cancel`,
				body: {
					reason: "Coinflip expired - automatic cancellation",
				},
			});

			if (response.statusCode !== 200) {
				throw new Error(`Failed to cancel transfer ${transferId}: ${response.statusCode}`);
			}
		} catch (error) {
			throw error;
		}
	}
}
