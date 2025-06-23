import { FastifyInstance } from "fastify";
import { RedisClientType } from "redis";
import { CaseRow, ItemRow } from "../endpoints/casebattles/get_cases";
import { getPostgresConnection } from "./postgres";
import { randomCaseBattleSpin } from "../utilities/secureRandomness";
import groupModeHandler from "../utilities/casebattles-mode-handlers/group";
import randomizerModeHandler from "../utilities/casebattles-mode-handlers/randomizer";
import showdownModeHandler from "../utilities/casebattles-mode-handlers/showdown";
import standardModeHandler from "../utilities/casebattles-mode-handlers/standard";

export interface CaseBattleData {
	id: string;
	server_id: string;
	server_seed: string;
	team_mode: "1v1" | "1v1v1" | "1v1v1v1" | "2v2";
	crazy: boolean;
	mode: "Standard" | "Randomized" | "Showdown" | "Group";
	fast_mode: boolean;
	players: {
		id: string;
		username: string;
		display_name: string;
		position: number;
		bot: boolean;
		client_seed: string;
	}[];
	cases: string[];
	player_pulls: {
		[player_id: string]: {
			items: {
				id: number;
				case_index: number;
				roll: string;
				hash: string;
				value: number;
			}[];
			total_value: number;
		};
	};
	current_spin_data: {
		current_case_index: number;
		case_id: string;
		progress: string;
	};
	winners_info?: {
		player_id: string;
		amount_won: number;
	}[];
	status: "waiting_for_players" | "in_progress" | "completed";
	next_step_at?: number;
	created_at: number;
	started_at: number;
	completed_at: number;
	updated_at: number;
}

const CASEBATTLE_EXPIRY = 3600;
const LOCK_EXPIRY = 10;

export class CasebattlesRedisManager {
	private redis: RedisClientType;
	private server: FastifyInstance;

	constructor(redis: RedisClientType, server: FastifyInstance) {
		this.redis = redis;
		this.server = server;
	}

	private getKey(type: string, id: string): string {
		return `casebattle:${type}:${id}`;
	}

	private async acquireLock(key: string, expirySeconds: number): Promise<boolean> {
		try {
			const res = await this.redis.set(key, "1", { NX: true, EX: expirySeconds });
			return res === "OK";
		} catch {
			return false;
		}
	}

	private async releaseLock(key: string): Promise<void> {
		try {
			await this.redis.del(key);
		} catch {}
	}

	private async hasActiveCaseBattle(userId: string): Promise<boolean> {
		const playerKey = this.getKey("player", userId);

		const existingId = await this.redis.get(playerKey);
		if (!existingId) return false;

		const existingGameRaw = await this.redis.get(this.getKey("game", existingId));
		if (!existingGameRaw) {
			await this.redis.del(playerKey);
			return false;
		}

		try {
			const existingGame: CaseBattleData = JSON.parse(existingGameRaw);
			const inactive = existingGame.status === "completed";
			if (inactive) {
				await this.redis.del(playerKey);
				return false;
			}
			return true;
		} catch {
			await this.redis.del(playerKey);
			return false;
		}
	}

	async createCaseBattle(data: CaseBattleData): Promise<boolean> {
		const lockKey = this.getKey("lock", data.players[0].id);
		const casebattleKey = this.getKey("game", data.id);
		const playerKey = this.getKey("player", data.players[0].id);

		if (await this.hasActiveCaseBattle(data.players[0].id)) {
			return false;
		}

		const result = await this.redis
			.multi()
			.set(lockKey, "1", { NX: true, EX: LOCK_EXPIRY })
			.set(casebattleKey, JSON.stringify(data), { NX: true, EX: CASEBATTLE_EXPIRY })
			.sAdd(this.getKey("server", data.server_id), data.id)
			.sAdd("casebattles:global", data.id)
			.set(playerKey, data.id, { NX: true, EX: CASEBATTLE_EXPIRY })
			.exec();

		if (!result || result.some((reply) => !reply)) {
			await this.redis.del([lockKey, casebattleKey, playerKey]);
			return false;
		}

		return true;
	}

	async joinCaseBattle(casebattleId: string, newPlayer: CaseBattleData["players"][number]): Promise<boolean> {
		const MAX_RETRIES = 3;
		const gameKey = this.getKey("game", casebattleId);
		const playerKey = this.getKey("player", newPlayer.id);

		for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
			try {
				await this.redis.watch(gameKey);

				const currentRaw = await this.redis.get(gameKey);
				if (!currentRaw) {
					await this.redis.unwatch();
					return false;
				}

				const current: CaseBattleData = JSON.parse(currentRaw);
				if (current.status !== "waiting_for_players") {
					await this.redis.unwatch();
					return false;
				}

				if (current.players.some((p) => p.id === newPlayer.id)) {
					await this.redis.unwatch();
					return false;
				}

				if (current.players.some((p) => p.position === newPlayer.position)) {
					await this.redis.unwatch();
					return false;
				}

				const maxPlayers = current.team_mode
					.split("v")
					.map((n) => parseInt(n, 10))
					.reduce((sum, n) => sum + n, 0);

				if (current.players.length >= maxPlayers) {
					await this.redis.unwatch();
					return false;
				}

				const updated: CaseBattleData = {
					...current,
					players: [...current.players, newPlayer],
					player_pulls: {
						...current.player_pulls,
						[newPlayer.id]: { items: [], total_value: 0 },
					},
					updated_at: Date.now(),
				};

				const execRes = await this.redis
					.multi()
					.set(gameKey, JSON.stringify(updated), { XX: true, EX: CASEBATTLE_EXPIRY })
					.set(playerKey, casebattleId, { NX: true, EX: CASEBATTLE_EXPIRY })
					.exec();

				if (execRes && !execRes.some((r) => !r)) {
					return true;
				}
			} catch (err) {
				await this.redis.unwatch();
				console.error(`Error joining casebattle: ${err}`);
			}
		}

		return false;
	}

	async getCaseBattle(id: string): Promise<CaseBattleData | null> {
		const data = await this.redis.get(this.getKey("game", id));
		return data ? JSON.parse(data) : null;
	}

	async getActiveCaseBattles(serverId?: string): Promise<string[]> {
		if (serverId) {
			return this.redis.sInter(["casebattles:global", this.getKey("server", serverId)]);
		}
		return this.redis.sMembers("casebattles:global");
	}

	async cancelCaseBattle(id: string, data: CaseBattleData): Promise<boolean> {
		const gameKey = this.getKey("game", id);
		const serverKey = this.getKey("server", data.server_id);

		const multi = this.redis.multi().del([gameKey]).sRem(serverKey, id).sRem("casebattles:global", id);

		for (const player of data.players) {
			multi.del([this.getKey("player", player.id)]);
		}

		const result = await multi.exec();
		return result !== null;
	}

	async getCases(caseId?: string): Promise<
		{
			items: ItemRow[];
			id: string;
			name: string;
			slug: string;
			image: string;
			price: number;
			total_opened: number;
			created_at: Date;
		}[]
	> {
		const BASE_KEY = "casebattle:cases";
		const TTL = 3600;

		if (caseId) {
			const singleKey = `${BASE_KEY}:${caseId}`;
			const cached = await this.redis.get(singleKey);
			if (cached) return [JSON.parse(cached)];
		} else {
			const keys: string[] = [];
			for await (const key of this.redis.scanIterator({
				MATCH: `${BASE_KEY}:*`,
				COUNT: 100,
			})) {
				if (Array.isArray(key)) {
					keys.push(...key);
				} else {
					keys.push(key);
				}
			}
			if (keys.length) {
				const cachedArr = await this.redis.mGet(keys);
				const parsed = cachedArr.filter((v): v is string => !!v).map((v) => JSON.parse(v));
				if (parsed.length === keys.length) {
					return parsed;
				}
			}
		}

		const connection = await getPostgresConnection();
		if (!connection) return [];

		const { rows: cases } = await connection.query<CaseRow>("SELECT * FROM casebattle_cases");
		const { rows: items } = await connection.query<ItemRow>("SELECT * FROM casebattle_items");
		await connection.release();

		const caseItems: Record<string, ItemRow[]> = {};
		for (const item of items) {
			(caseItems[item.case_id] ??= []).push(item);
		}

		const result = cases.map((c) => ({
			...c,
			items: caseItems[c.id] || [],
		}));

		const pipeline = this.redis.multi();
		for (const c of result) {
			const key = `${BASE_KEY}:${c.id}`;
			pipeline.set(key, JSON.stringify(c), { EX: TTL });
		}
		await pipeline.exec();

		return result;
	}

	async startCaseBattle(id: string): Promise<boolean> {
		const lockKey = this.getKey("start-lock", id);
		const gotLock = await this.acquireLock(lockKey, 30);
		if (!gotLock) return false;

		try {
			const gameKey = this.getKey("game", id);
			const currentGame = await this.redis.get(gameKey);
			if (!currentGame) {
				await this.releaseLock(lockKey);
				return false;
			}

			const current: CaseBattleData = JSON.parse(currentGame);
			if (current.status !== "waiting_for_players") {
				await this.releaseLock(lockKey);
				return false;
			}

			const nowMs = Date.now();
			const updated: CaseBattleData = {
				...current,
				status: "in_progress",
				started_at: nowMs,
				updated_at: nowMs,
				next_step_at: nowMs,
			};

			await this.redis.set(gameKey, JSON.stringify(updated), { XX: true, EX: CASEBATTLE_EXPIRY });
			return true;
		} finally {
			await this.releaseLock(lockKey);
		}
	}

	async stepCaseBattle(id: string): Promise<boolean> {
		const lockKey = this.getKey("step-lock", id);
		const gotLock = await this.acquireLock(lockKey, 30);
		if (!gotLock) return false;

		try {
			const gameKey = this.getKey("game", id);
			const battleRaw = await this.redis.get(gameKey);
			if (!battleRaw) {
				await this.releaseLock(lockKey);
				return false;
			}

			let battle: CaseBattleData = JSON.parse(battleRaw);
			if (battle.status !== "in_progress") {
				await this.releaseLock(lockKey);
				return false;
			}

			const nowMs = Date.now();

			if (battle.next_step_at !== undefined && nowMs < battle.next_step_at) {
				await this.releaseLock(lockKey);
				return false;
			}

			const nextIndex = (battle.current_spin_data?.current_case_index ?? -1) + 1;
			if (nextIndex >= battle.cases.length) {
				await this.finalizeBattle(battle, gameKey);
				return true;
			}

			const caseId = battle.cases[nextIndex];
			const [caseData] = await this.getCases(caseId);
			if (!caseData) {
				await this.releaseLock(lockKey);
				return false;
			}

			for (const player of battle.players) {
				const { result, hash, roll } = randomCaseBattleSpin(
					caseData.items,
					player.client_seed,
					battle.server_seed,
					nextIndex,
				);

				if (!battle.player_pulls[player.id]) battle.player_pulls[player.id] = { items: [], total_value: 0 };
				battle.player_pulls[player.id].items.push({
					id: result.id,
					roll,
					hash,
					case_index: nextIndex,
					value: result.value,
				});
				battle.player_pulls[player.id].total_value += result.value;
			}

			battle.current_spin_data.current_case_index = nextIndex;
			battle.current_spin_data.case_id = caseId;
			battle.current_spin_data.progress = `${nextIndex + 1}/${battle.cases.length}`;
			battle.next_step_at = nowMs + (battle.fast_mode ? 4 : 6) * 1000;
			battle.updated_at = Date.now();

			await this.redis.set(gameKey, JSON.stringify(battle), { XX: true, EX: CASEBATTLE_EXPIRY });
			return true;
		} finally {
			await this.releaseLock(lockKey);
		}
	}

	private async finalizeBattle(battle: CaseBattleData, gameKey: string): Promise<void> {
		if (battle.status === "completed") return;

		let winningPlayers: { player_id: string; amount_won: number }[] = [];
		if (battle.mode === "Group") {
			winningPlayers = groupModeHandler(battle);
		} else if (battle.mode === "Randomized") {
			winningPlayers = randomizerModeHandler(battle);
		} else if (battle.mode === "Showdown") {
			winningPlayers = showdownModeHandler(battle);
		} else if (battle.mode === "Standard") {
			winningPlayers = standardModeHandler(battle);
		}

		const winningsMap: Record<string, number> = winningPlayers.reduce((acc, { player_id, amount_won }) => {
			acc[player_id] = amount_won;
			return acc;
		}, {} as Record<string, number>);
		for (const player of battle.players) {
			if (battle.player_pulls[player.id]) {
				battle.player_pulls[player.id].total_value = winningsMap[player.id] ?? 0;
			}
		}

		battle.winners_info = winningPlayers;
		battle.completed_at = Date.now();
		battle.status = "completed";
		battle.updated_at = Date.now();
		battle.current_spin_data.current_case_index = battle.cases.length + 1;

		await this.redis.set(gameKey, JSON.stringify(battle), { XX: true, EX: 10 });

		const pgClient = await getPostgresConnection();
		const values = winningPlayers
			.filter((p) => !p.player_id.startsWith("bot_"))
			.map((p) => [p.player_id, p.amount_won]);
		if (values.length) {
			const placeholders = values.map((_, idx) => `($${idx * 2 + 1}, $${idx * 2 + 2}, 'pending')`).join(", ");
			await pgClient.query(
				`INSERT INTO external_cash_change_requests (user_id, amount, status) VALUES ${placeholders}`,
				values.flat(),
			);
		}
		await pgClient.release();
	}
}
