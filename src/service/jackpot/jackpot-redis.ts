import { FastifyInstance } from "fastify";
import { RedisClientType } from "redis";
import { randomJackpotSpin } from "../../utilities/secureRandomness";
import internalRequest from "../../utilities/internalRequest";
import { getPostgresConnection } from "../postgres";
import getTotalValue from "../../utilities/getTotalValue";

export interface JackpotData {
	id: string;
	server_id: string;
	server_seed: string;
	creator: { id: string; username: string; display_name: string };
	value_cap: number;
	joinable: boolean;
	leaveable: boolean;
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
	transfer_id?: string;
	is_system_pot?: boolean;
	auto_start_ts?: number;
	value_floor?: number;
	max_players?: number;
}

const JACKPOT_EXPIRY = 3600;
const LOCK_EXPIRY = 10;
const HOLDING_ACCOUNT_ID = "1";

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

		if (!result || result.some((reply) => reply === null)) {
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

	async joinJackpot(jackpotId: string, userId: number, newMember: JackpotData["members"][number]): Promise<boolean> {
		const MAX_RETRIES = 3;

		const gameKey = this.getKey("game", jackpotId);
		const userKey = this.getKey("user", userId.toString());

		for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
			try {
				await this.redis.watch([gameKey, userKey]);

				const currentGameRaw = await this.redis.get(gameKey);
				if (!currentGameRaw) {
					console.debug(
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
					!current.joinable ||
					(current.max_players !== undefined && current.members.length >= current.max_players)
				) {
					console.debug(
						`[JackpotRedis] joinJackpot failed: jackpot ${jackpotId} already started or locked (attempt ${
							attempt + 1
						})`,
					);
					await this.redis.unwatch();
					return false;
				}

				const userAlreadyPlayingRaw = await this.redis.get(userKey);
				if (userAlreadyPlayingRaw) {
					const otherGameRaw = await this.redis.get(this.getKey("game", userAlreadyPlayingRaw));
					if (!otherGameRaw) {
						await this.redis.del(userKey);
					} else {
						const otherGame: JackpotData = JSON.parse(otherGameRaw);
						if (otherGame.status !== "complete") {
							console.debug(
								`[JackpotRedis] joinJackpot failed: user ${userId} is already in another active jackpot ${userAlreadyPlayingRaw} (attempt ${
									attempt + 1
								})`,
							);
							await this.redis.unwatch();
							return false;
						} else {
							await this.redis.del(userKey);
						}
					}
				}

				const isFirstMemberSystemPot = current.is_system_pot === true && current.members.length === 0;
				const updated: JackpotData = {
					...current,
					members: [...current.members, newMember],
					...(isFirstMemberSystemPot ? { auto_start_ts: Math.floor(Date.now() / 1000) + 120 } : {}),
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

			let adjustedMembers = current.members;
			let membersChanged = false;
			try {
				const connection = await getPostgresConnection();
				try {
					const pairs: Array<[string, string]> = [];
					for (const m of current.members) {
						for (const itm of m.items) {
							const uaid = itm.split(":")[0];
							pairs.push([uaid, m.player.id]);
						}
					}

					if (pairs.length > 0) {
						const pgParams: any[] = [];
						const placeholders: string[] = [];
						pairs.forEach(([uaid, ownerId], idx) => {
							const p1 = idx * 2 + 1;
							const p2 = idx * 2 + 2;
							placeholders.push(`($${p1}, $${p2})`);
							pgParams.push(uaid, ownerId);
						});

						const { rows: ownedItems } = await connection.query<{
							owner_id: string;
							user_asset_id: string;
						}>(
							`SELECT owner_id, user_asset_id FROM item_copies WHERE (user_asset_id, owner_id) IN (${placeholders.join(
								", ",
							)})`,
							pgParams,
						);

						const ownedSet = new Set(ownedItems.map((oi) => `${oi.user_asset_id}_${oi.owner_id}`));

						const newMembers: typeof adjustedMembers = [];
						for (const m of current.members) {
							const validItems = m.items.filter((itm) => {
								const uaid = itm.split(":")[0];
								return ownedSet.has(`${uaid}_${m.player.id}`);
							});

							if (validItems.length === m.items.length) {
								newMembers.push(m); // unchanged
								continue;
							}

							membersChanged = true;
							if (validItems.length === 0) {
								continue;
							}

							const newValue = await getTotalValue(validItems);
							newMembers.push({ ...m, items: validItems, total_value: newValue });
						}

						adjustedMembers = newMembers;
					}
				} finally {
					connection.release();
				}
			} catch (verifyErr) {
				console.error(`[JackpotRedis] startJackpot verification error for ${id}:`, verifyErr);
			}

			if (membersChanged) {
				current.members = adjustedMembers;
				current.updated_at = Date.now();
				await this.redis.set(this.getKey("game", id), JSON.stringify(current), {
					XX: true,
					EX: JACKPOT_EXPIRY,
				});
			}

			if (current.members.length === 0) {
				console.warn(
					`[JackpotRedis] startJackpot aborted: jackpot ${id} has no valid members after verification`,
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

			const transferResponse = await internalRequest(this.server, {
				method: "POST",
				url: "/items/item-transfer",
				body: current.members.map((m) => {
					return {
						user_id: m.player.id,
						items: m.items.map((i) => i.split(":")[0]),
					};
				}),
			});

			if (transferResponse.statusCode !== 200) {
				console.error(`[JackpotRedis] startJackpot failed: failed to create transfer for jackpot ${id}`);
				await this.redis.del(lockKey);
				return false;
			}

			const body = JSON.parse(transferResponse.body);
			const lockResponse = await internalRequest(this.server, {
				method: "POST",
				url: `/items/item-transfer/${body.transfer_id}/confirm`,
				body: { user_id: HOLDING_ACCOUNT_ID },
			});

			if (lockResponse.statusCode !== 200) {
				console.error(
					`[JackpotRedis] startJackpot failed: failed to lock items for jackpot ${id} (transfer ${body.transfer_id})`,
				);
				await this.redis.del(lockKey);
				return false;
			}

			current.transfer_id = body.transfer_id;
			await this.redis.set(gameKey, JSON.stringify(current), { XX: true, EX: JACKPOT_EXPIRY });

			return true;
		} catch (err) {
			console.error(`[JackpotRedis] startJackpot unexpected error for ${id}:`, err);
			await this.redis.del(lockKey);
			return false;
		}
	}

	async finalizeJackpot(id: string): Promise<void> {
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

		const allUaid = current.members.flatMap((m) => m.items.map((it) => it.split(":")[0]));
		if (allUaid.length === 0) {
			console.error(`[JackpotRedis] finalizeJackpot failed: no items found in jackpot ${id}`);
			return;
		}

		const createTransferResp = await internalRequest(this.server, {
			method: "POST",
			url: "/items/item-transfer",
			body: [
				{
					user_id: HOLDING_ACCOUNT_ID,
					items: allUaid,
				},
			],
		});

		if (createTransferResp.statusCode !== 200) {
			console.error(`[JackpotRedis] finalizeJackpot failed: unable to create winner transfer for jackpot ${id}`);
			return;
		}

		const { transfer_id: winnerTransferId } = JSON.parse(createTransferResp.body);
		const winnerConfirmResp = await internalRequest(this.server, {
			method: "POST",
			url: `/items/item-transfer/${winnerTransferId}/confirm`,
			body: {
				user_id: winner.player.id,
			},
		});

		if (winnerConfirmResp.statusCode !== 200) {
			console.error(
				`[JackpotRedis] finalizeJackpot failed: failed to transfer items to winner for jackpot ${id}`,
			);
			return;
		}

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
	}
}
