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
	countdown_end_at: number;
	created_at: number;
	updated_at: number;
	transfer_id?: string;
	is_system_pot?: boolean;
	auto_start_at?: number;
	value_floor?: number;
	max_players?: number;
}

const JACKPOT_EXPIRY = 3600;
const LOCK_EXPIRY = 10;
const HOLDING_ACCOUNT_ID = "1";

const MIN_MEMBERS = 1;

const TOTAL_TICKETS = 100_000;

const JOIN_MAX_RETRIES = 3;

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
			await this.redis.del([lockKey, jackpotKey, creatorKey]);
			return false;
		}

		return true;
	}

	async joinJackpot(jackpotId: string, userId: number, newMember: JackpotData["members"][number]): Promise<boolean> {
		const MAX_RETRIES = JOIN_MAX_RETRIES;

		const gameKey = this.getKey("game", jackpotId);
		const userKey = this.getKey("user", userId.toString());

		for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
			try {
				await this.redis.watch([gameKey, userKey]);

				const currentGameRaw = await this.redis.get(gameKey);
				if (!currentGameRaw) {
					await this.redis.unwatch();
					return false;
				}

				const current: JackpotData = JSON.parse(currentGameRaw);

				if (
					(current.countdown_end_at !== -1 && current.countdown_end_at <= Date.now()) ||
					!current.joinable ||
					(current.max_players !== undefined && current.members.length >= current.max_players)
				) {
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
							await this.redis.unwatch();
							return false;
						} else {
							await this.redis.del(userKey);
						}
					}
				}

				const now = Date.now();
				const updatedMembers = [...current.members, newMember];
				const shouldSetAutoStart = current.is_system_pot === true && current.auto_start_at === undefined;

				const updated: JackpotData = {
					...current,
					members: updatedMembers,
					...(shouldSetAutoStart ? { auto_start_at: now + 30_000 } : {}),
					updated_at: now,
				};

				const execResult = await this.redis
					.multi()
					.set(gameKey, JSON.stringify(updated), { XX: true, EX: JACKPOT_EXPIRY })
					.set(userKey, jackpotId, { NX: true, EX: JACKPOT_EXPIRY })
					.exec();

				if (execResult && !execResult.some((reply) => !reply)) {
					return true;
				}
			} catch (err) {
				await this.redis.unwatch();
				throw err;
			}
		}

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
		const _now = Date.now();
		const lockKey = this.getKey("start_lock", id);
		const haveLock = await this.redis.set(lockKey, "1", { NX: true, EX: LOCK_EXPIRY });
		if (!haveLock) return false;

		try {
			const gameKey = this.getKey("game", id);
			const currentRaw = await this.redis.get(gameKey);
			if (!currentRaw) {
				await this.redis.del(lockKey);
				return false;
			}

			const current: JackpotData = JSON.parse(currentRaw);
			const originalMemberIds = current.members.map((m) => m.player.id);
			const now = Date.now();
			const updated: JackpotData = {
				...current,
				status: "waiting_for_start",
				countdown_end_at: -1,
				joinable: false,
				leaveable: false,
				updated_at: now,
			};

			const updatedOk = await this.redis.set(gameKey, JSON.stringify(updated), { XX: true, EX: JACKPOT_EXPIRY });
			if (!updatedOk) {
				await this.redis.del(lockKey);
				return false;
			}

			if (current.status !== "waiting_for_start") {
				await this.redis.del(lockKey);
				return false;
			}

			let adjustedMembers = current.members;
			let membersChanged = false;
			try {
				const connection = await getPostgresConnection();
				try {
					const uaids: string[] = [];
					const ownerIds: string[] = [];
					for (const m of current.members) {
						for (const itm of m.items) {
							const uaid = itm.split(":")[0];
							uaids.push(uaid);
							ownerIds.push(m.player.id);
						}
					}

					if (uaids.length > 0) {
						const { rows: ownedItems } = await connection.query<{
							owner_id: string;
							user_asset_id: string;
						}>(
							`SELECT ic.owner_id, ic.user_asset_id
						   FROM item_copies AS ic
						   JOIN UNNEST($1::text[], $2::text[]) AS vals(user_asset_id, owner_id)
						        ON ic.user_asset_id = vals.user_asset_id AND ic.owner_id::text = vals.owner_id`,
							[uaids, ownerIds],
						);

						const ownedSet = new Set(ownedItems.map((oi) => `${oi.user_asset_id}_${oi.owner_id}`));

						const newMembers: typeof adjustedMembers = [];
						for (const m of current.members) {
							const validItems = m.items.filter((itm) => {
								const uaid = itm.split(":")[0];
								return ownedSet.has(`${uaid}_${m.player.id}`);
							});

							if (validItems.length === m.items.length) {
								newMembers.push(m);
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
			} catch (verifyErr) {}

			if (membersChanged) {
				const remainingIds = new Set(adjustedMembers.map((m) => m.player.id));
				const removedIds = originalMemberIds.filter((uid) => !remainingIds.has(uid));

				current.members = adjustedMembers;
				current.updated_at = Date.now();

				const updateMulti = this.redis.multi();
				updateMulti.set(this.getKey("game", id), JSON.stringify(current), {
					XX: true,
					EX: JACKPOT_EXPIRY,
				});
				for (const uid of removedIds) {
					updateMulti.del(this.getKey("user", uid));
				}
				await updateMulti.exec();
			}

			if (current.members.length < MIN_MEMBERS) {
				const creatorKey = this.getKey("creator", current.creator.id);
				const serverSetKey = this.getKey("server", current.server_id);

				const cleanup = this.redis.multi();
				cleanup.del(gameKey);
				cleanup.del(creatorKey);
				cleanup.sRem("jackpots:global", id);
				cleanup.sRem(serverSetKey, id);
				for (const uid of originalMemberIds) {
					cleanup.del(this.getKey("user", uid));
				}
				cleanup.del(lockKey);

				await cleanup.exec();
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
				try {
					const rollbackPot: JackpotData = {
						...current,
						status: "waiting_for_start",
						countdown_end_at: -1,
						joinable: true,
						leaveable: true,
						updated_at: Date.now(),
					};
					await this.redis.set(gameKey, JSON.stringify(rollbackPot), { XX: true, EX: JACKPOT_EXPIRY });
				} catch (rollbackErr) {}

				await this.redis.del(lockKey);
				return false;
			}

			const body = JSON.parse(transferResponse.body);
			const lockResponse = await internalRequest(this.server, {
				method: "POST",
				url: `/items/item-transfer/${body.transfer_id}/confirm?skip_locked=true`,
				body: { user_id: HOLDING_ACCOUNT_ID },
			});

			if (lockResponse.statusCode !== 200) {
				try {
					await internalRequest(this.server, {
						method: "POST",
						url: `/items/item-transfer/${body.transfer_id}/cancel`,
						body: { reason: "Jackpot start failed - automatic rollback" },
					});
				} catch (_) {}

				try {
					const rollbackPot: JackpotData = {
						...current,
						status: "waiting_for_start",
						countdown_end_at: -1,
						joinable: true,
						leaveable: true,
						updated_at: Date.now(),
					};
					await this.redis.set(gameKey, JSON.stringify(rollbackPot), { XX: true, EX: JACKPOT_EXPIRY });
				} catch (rollbackErr) {}

				await this.redis.del(lockKey);
				return false;
			}

			let skippedItems: string[] = [];
			try {
				const parsedLockBody = JSON.parse(lockResponse.body);
				if (Array.isArray(parsedLockBody?.skipped_items)) {
					skippedItems = parsedLockBody.skipped_items as string[];
				}
			} catch (_) {}

			if (skippedItems.length > 0) {
				const recalcMembers: typeof current.members = [];
				for (const m of current.members) {
					const remaining = m.items.filter((i) => !skippedItems.includes(i.split(":")[0]));
					if (remaining.length === 0) {
						continue;
					}
					const newValue = await getTotalValue(remaining);
					recalcMembers.push({ ...m, items: remaining, total_value: newValue });
				}

				if (recalcMembers.length < MIN_MEMBERS) {
					try {
						await internalRequest(this.server, {
							method: "POST",
							url: `/items/item-transfer/${body.transfer_id}/cancel`,
							body: { reason: "Jackpot start aborted – insufficient items after lock removal" },
						});
					} catch (_) {}

					const rollbackPot: JackpotData = {
						...current,
						members: recalcMembers,
						status: "waiting_for_start",
						countdown_end_at: -1,
						joinable: true,
						leaveable: true,
						updated_at: Date.now(),
					};
					await this.redis.set(gameKey, JSON.stringify(rollbackPot), { XX: true, EX: JACKPOT_EXPIRY });
					await this.redis.del(lockKey);
					return false;
				}

				current.members = recalcMembers;
				current.updated_at = Date.now();
			}

			current.transfer_id = body.transfer_id;
			await this.redis.set(gameKey, JSON.stringify(current), { XX: true, EX: JACKPOT_EXPIRY });

			const COUNTDOWN = 3;
			const nowCountdown = Date.now();
			const potInCountdown: JackpotData = {
				...current,
				status: "countdown",
				countdown_end_at: nowCountdown + COUNTDOWN * 1000,
				joinable: false,
				leaveable: false,
				updated_at: nowCountdown,
			};

			const MAX_SET_RETRIES = 3;
			let committed = false;
			for (let attempt = 1; attempt <= MAX_SET_RETRIES && !committed; attempt++) {
				try {
					const res = await this.redis.set(gameKey, JSON.stringify(potInCountdown), {
						XX: true,
						EX: JACKPOT_EXPIRY,
					});
					if (res) {
						committed = true;
						break;
					}
					await this.redis.set(gameKey, JSON.stringify(potInCountdown), {
						NX: true,
						EX: JACKPOT_EXPIRY,
					});
					committed = true;
				} catch (err) {
					if (attempt === MAX_SET_RETRIES) {
						try {
							await internalRequest(this.server, {
								method: "POST",
								url: `/items/item-transfer/${current.transfer_id}/cancel`,
								body: { reason: "Jackpot countdown commit failed - automatic rollback" },
							});
						} catch (_) {}
						await this.redis.del(lockKey);
						return false;
					}
				}
			}

			await this.redis.expire(lockKey, COUNTDOWN + 5);

			return true;
		} catch (err) {
			await this.redis.del(lockKey);
			return false;
		}
	}

	async finalizeJackpot(id: string): Promise<void> {
		const lockKey = this.getKey("finalize_lock", id);
		const haveLock = await this.redis.set(lockKey, "1", { NX: true, EX: 60 });
		if (!haveLock) {
			return;
		}

		try {
			const gameKey = this.getKey("game", id);
			const currentRaw = await this.redis.get(gameKey);
			if (!currentRaw) {
				return;
			}

			const current: JackpotData = JSON.parse(currentRaw);
			if (current.status === "complete") return;

			if (current.members.length < MIN_MEMBERS) {
				return;
			}

			const totalPoolValue = current.members.reduce((sum, m) => sum + m.total_value, 0);
			if (totalPoolValue === 0) {
				return;
			}

			const prelim = current.members.map((m) => {
				const exact = (m.total_value / totalPoolValue) * TOTAL_TICKETS;
				return {
					player: m.player,
					base: Math.floor(exact),
					remainder: exact - Math.floor(exact),
				};
			});

			let allocated = prelim.reduce((s, p) => s + p.base, 0);
			let leftover = TOTAL_TICKETS - allocated;
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

			const nowFinal = Date.now();
			current.winning_data = { player: winner.player };
			current.status = "complete";
			current.updated_at = nowFinal;

			const allUaid = Array.from(new Set(current.members.flatMap((m) => m.items.map((it) => it.split(":")[0]))));

			if (allUaid.length === 0) {
				return;
			}

			const CHUNK_SIZE = 200;
			for (let i = 0; i < allUaid.length; i += CHUNK_SIZE) {
				const chunk = allUaid.slice(i, i + CHUNK_SIZE);
				const createResp = await internalRequest(this.server, {
					method: "POST",
					url: "/items/item-transfer",
					body: [
						{
							user_id: HOLDING_ACCOUNT_ID,
							items: chunk,
						},
					],
				});

				if (createResp.statusCode !== 200) return;
				const { transfer_id: chunkTransferId } = JSON.parse(createResp.body);
				const confirmResp = await internalRequest(this.server, {
					method: "POST",
					url: `/items/item-transfer/${chunkTransferId}/confirm`,
					body: {
						user_id: winner.player.id,
					},
				});

				if (confirmResp.statusCode !== 200) {
					return;
				}
			}

			const userKeysToRemove = current.members.map((m) => this.getKey("user", m.player.id));
			const creatorKey = this.getKey("creator", current.creator.id);

			const multi = this.redis.multi();
			multi.set(gameKey, JSON.stringify(current), { XX: true, EX: 30 });
			for (const key of [...userKeysToRemove, creatorKey, this.getKey("start_lock", id)]) {
				multi.del(key);
			}

			const execResult = await multi.exec();
			if (execResult === null || execResult[0] == null) return;

			try {
				const connection = await getPostgresConnection();
				try {
					await connection.query(
						`INSERT INTO jackpot_logs (
							jackpot_id,
							server_id,
							creator_id,
							winning_user_id,
							total_value,
							members,
							created_at,
							finalized_at
						) VALUES (
							$1, $2, $3, $4, $5, $6::jsonb, to_timestamp($7 / 1000.0), to_timestamp($8 / 1000.0)
						)`,
						[
							id,
							current.server_id,
							current.creator.id,
							winner.player.id,
							totalPoolValue,
							JSON.stringify(current.members),
							current.created_at,
							nowFinal,
						],
					);
				} catch (logErr) {
					console.error("[jackpot] failed to record jackpot log:", logErr);
				} finally {
					connection.release();
				}
			} catch (connErr) {
				console.error("[jackpot] failed to obtain DB connection for jackpot log:", connErr);
			}
		} finally {
			await this.redis.del(lockKey);
		}
	}
}
