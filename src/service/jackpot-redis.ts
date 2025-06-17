import { FastifyInstance } from "fastify";
import { RedisClientType } from "redis";
import { randomJackpotSpin } from "../utilities/secureRandomness";

export interface JackpotData {
	id: string;
	server_id: string;
	server_seed: string;
	creator: { id: string; username: string; display_name: string };
	value_cap: number;
	joinable: boolean;
	leaveable: boolean;
	starting_method: "countdown" | "manual";
	status: "countdown" | "waiting_for_start" | "in_progress" | "complete";
	members: {
		player: { id: string; username: string; display_name: string };
		total_value: number;
		items: string[];
		client_seed: string;
	}[];
	winning_data?: {
		player: { id: string; username: string; display_name: string };
	};
	starting_at: number;
	created_at: number;
	updated_at: number;
}

const JACKPOT_EXPIRY = 3600;
const LOCK_EXPIRY = 10;

export class JackpotRedisManager {
	private redis: RedisClientType;
	private server: FastifyInstance;

	constructor(redis: RedisClientType, server: FastifyInstance) {
		this.redis = redis;
		this.server = server;
	}

	private getKey(type: string, id: string): string {
		return `jackpot:${type}:${id}`;
	}

	private async delay(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	async createJackpot(data: JackpotData): Promise<boolean> {
		const lockKey = this.getKey("lock", data.creator.id);
		const jackpotKey = this.getKey("game", data.id);
		const creatorKey = this.getKey("creator", data.creator.id);

		const result = await this.redis
			.multi()
			.set(lockKey, "1", { NX: true, EX: LOCK_EXPIRY })
			.set(jackpotKey, JSON.stringify(data), { NX: true, EX: JACKPOT_EXPIRY })
			.sAdd(this.getKey("server", data.server_id), data.id)
			.sAdd("jackpots:global", data.id)
			.set(creatorKey, data.id, { NX: true, EX: JACKPOT_EXPIRY })
			.exec();

		if (!result || result.some((reply) => !reply)) {
			console.warn(
				`[JackpotRedis] createJackpot failed for jackpot ${data.id}. Redis transaction result: ${JSON.stringify(
					result,
				)}`,
			);
			await this.redis.del([lockKey, jackpotKey, creatorKey]);
			return false;
		}

		return true;
	}

	/**
	 * Safely add a new member to a jackpot using optimistic locking (WATCH/MULTI).
	 * The updated jackpot state is derived **inside** the critical section so that
	 * concurrent join requests are merged instead of overwriting each other.
	 */
	async joinJackpot(jackpotId: string, userId: number, newMember: JackpotData["members"][number]): Promise<boolean> {
		const MAX_RETRIES = 3;
		const RETRY_DELAY_MS = 100;

		const gameKey = this.getKey("game", jackpotId);
		const userKey = this.getKey("user", userId.toString());

		for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
			try {
				await this.redis.watch([gameKey, userKey]);

				const currentGameRaw = await this.redis.get(gameKey);
				if (!currentGameRaw) {
					console.warn(
						`[JackpotRedis] joinJackpot failed: jackpot ${jackpotId} not found or expired (attempt ${
							attempt + 1
						})`,
					);
					await this.redis.unwatch();
					return false;
				}

				const current: JackpotData = JSON.parse(currentGameRaw);

				if (
					(current.starting_at !== -1 && current.starting_at <= Math.floor(Date.now() / 1000)) ||
					!current.joinable
				) {
					console.warn(
						`[JackpotRedis] joinJackpot failed: jackpot ${jackpotId} already started or locked (attempt ${
							attempt + 1
						})`,
					);
					await this.redis.unwatch();
					return false;
				}

				const userAlreadyPlaying = await this.redis.exists(userKey);
				if (userAlreadyPlaying) {
					console.warn(
						`[JackpotRedis] joinJackpot failed: user ${userId} is already in another jackpot (attempt ${
							attempt + 1
						})`,
					);
					await this.redis.unwatch();
					return false;
				}

				const updated: JackpotData = {
					...current,
					members: [...current.members, newMember],
					updated_at: Date.now(),
				};

				const execResult = await this.redis
					.multi()
					.set(gameKey, JSON.stringify(updated), { XX: true, EX: JACKPOT_EXPIRY })
					.set(userKey, jackpotId, { NX: true, EX: JACKPOT_EXPIRY })
					.exec();

				if (execResult && !execResult.some((reply) => !reply)) {
					return true;
				}

				console.debug(`Join attempt ${attempt + 1} for jackpot ${jackpotId} conflicted, retrying...`);
				await this.delay(RETRY_DELAY_MS);
			} catch (err) {
				await this.redis.unwatch();
				throw err;
			}
		}

		console.warn(`Failed to join jackpot ${jackpotId} after ${MAX_RETRIES} attempts`);
		return false;
	}

	async getJackpot(id: string): Promise<JackpotData | null> {
		const data = await this.redis.get(this.getKey("game", id));
		return data ? JSON.parse(data) : null;
	}

	async getActiveJackpots(serverId?: string): Promise<string[]> {
		if (serverId) {
			return this.redis.sInter(["jackpots:global", this.getKey("server", serverId)]);
		}
		return this.redis.sMembers("jackpots:global");
	}

	async startJackpot(id: string): Promise<boolean> {
		const lockKey = this.getKey("start_lock", id);
		const haveLock = await this.redis.set(lockKey, "1", { NX: true, EX: LOCK_EXPIRY });
		if (!haveLock) {
			console.warn(`[JackpotRedis] startJackpot aborted – another process is already starting jackpot ${id}`);
			return false;
		}

		try {
			const gameKey = this.getKey("game", id);
			const currentRaw = await this.redis.get(gameKey);
			if (!currentRaw) {
				console.warn(`[JackpotRedis] startJackpot failed: jackpot ${id} not found or expired`);
				await this.redis.del(lockKey);
				return false;
			}

			const current: JackpotData = JSON.parse(currentRaw);

			if (current.status !== "waiting_for_start") {
				console.warn(
					`[JackpotRedis] startJackpot failed: jackpot ${id} has incorrect status (${current.status})`,
				);
				await this.redis.del(lockKey);
				return false;
			}

			const COUNTDOWN = 10;
			const updated: JackpotData = {
				...current,
				status: "countdown",
				starting_at: Math.floor(Date.now() / 1000) + COUNTDOWN,
				joinable: false,
				leaveable: false,
				updated_at: Date.now(),
			};

			const updatedOk = await this.redis.set(gameKey, JSON.stringify(updated), { XX: true, EX: JACKPOT_EXPIRY });
			if (!updatedOk) {
				console.warn(`[JackpotRedis] startJackpot failed: failed to update jackpot ${id}`);
				await this.redis.del(lockKey);
				return false;
			}

			setTimeout(() => {
				this.finalizeJackpot(id).catch((err) =>
					console.error(`[JackpotRedis] finalizeJackpot error for ${id}:`, err),
				);
			}, COUNTDOWN * 1000);

			return true;
		} catch (err) {
			console.error(`[JackpotRedis] startJackpot unexpected error for ${id}:`, err);
			await this.redis.del(lockKey);
			return false;
		}
	}

	private async finalizeJackpot(id: string): Promise<void> {
		const gameKey = this.getKey("game", id);
		const currentRaw = await this.redis.get(gameKey);
		if (!currentRaw) {
			console.warn(`[JackpotRedis] finalizeJackpot failed: jackpot ${id} not found or expired`);
			return;
		}

		const current: JackpotData = JSON.parse(currentRaw);
		if (current.status === "complete") return;

		const totalPoolValue = current.members.reduce((sum, m) => sum + m.total_value, 0);
		if (totalPoolValue === 0) {
			console.warn(`[JackpotRedis] finalizeJackpot aborted: jackpot ${id} has zero total value`);
			return;
		}

		const prelim = current.members.map((m) => {
			const exact = (m.total_value / totalPoolValue) * 100000;
			return {
				player: m.player,
				base: Math.floor(exact),
				remainder: exact - Math.floor(exact),
			};
		});

		let allocated = prelim.reduce((s, p) => s + p.base, 0);
		let leftover = 100000 - allocated;
		prelim
			.sort((a, b) =>
				b.remainder !== a.remainder ? b.remainder - a.remainder : a.player.id.localeCompare(b.player.id),
			)
			.slice(0, leftover)
			.forEach((p) => p.base++);

		let cursor = 0;
		const playerTickets = prelim
			.sort((a, b) => a.player.id.localeCompare(b.player.id))
			.map((p) => {
				const min_ticket = cursor;
				const max_ticket = cursor + p.base - 1;
				cursor = max_ticket + 1;
				return { player: p.player, min_ticket, max_ticket };
			});

		const clientSeed = current.members
			.sort((a, b) => a.player.id.localeCompare(b.player.id))
			.map((m) => m.client_seed)
			.join("|");

		const { player: winner } = randomJackpotSpin(playerTickets, clientSeed, current.server_seed);

		current.winning_data = { player: winner.player };
		current.status = "complete";
		current.updated_at = Date.now();

		const userKeysToRemove = current.members.map((m) => this.getKey("user", m.player.id));
		const creatorKey = this.getKey("creator", current.creator.id);

		const multi = this.redis.multi();
		multi.set(gameKey, JSON.stringify(current), { XX: true, EX: 30 });
		for (const key of [...userKeysToRemove, creatorKey, this.getKey("start_lock", id)]) {
			multi.del(key);
		}

		const execResult = await multi.exec();
		if (execResult === null || execResult[0] == null) {
			console.error(`[JackpotRedis] finalizeJackpot failed to commit results for jackpot ${id}`);
			return;
		}

		setTimeout(() => {
			Promise.all([
				this.redis.sRem("jackpots:global", id),
				this.redis.sRem(this.getKey("server", current.server_id), id),
			])
				.catch((err) =>
					console.error(`[JackpotRedis] Deferred cleanup failed for jackpot ${id}:`, err),
				);
		}, 30000);
	}
}
