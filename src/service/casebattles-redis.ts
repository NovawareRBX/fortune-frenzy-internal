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
		progress: string; // ie. "1/5"
	};
	winners_info?: {
		player_id: string;
		amount_won: number;
	}[];
	status: "waiting_for_players" | "in_progress" | "completed";
	created_at: number;
	started_at: number;
	completed_at: number;
	updated_at: number;
}

const CASEBATTLE_EXPIRY = 3600; // 1 hour
const LOCK_EXPIRY = 10; // 10 seconds, reduced for faster lock release

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

	private async delay(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
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
		} catch {
			// ignore
		}
	}

	async createCaseBattle(data: CaseBattleData): Promise<boolean> {
		const lockKey = this.getKey("lock", data.players[0].id);
		const casebattleKey = this.getKey("game", data.id);
		const playerKey = this.getKey("player", data.players[0].id);

		const existingBattle = await this.redis.get(playerKey);
		if (existingBattle) {
			const existingGame = await this.redis.get(this.getKey("game", existingBattle));
			if (existingGame) {
				const gameData: CaseBattleData = JSON.parse(existingGame);
				if (gameData.status !== "completed") {
					return false;
				}
			}
		}

		const result = await this.redis
			.multi()
			.set(lockKey, "1", { NX: true, EX: LOCK_EXPIRY })
			.set(casebattleKey, JSON.stringify(data), { NX: true, EX: CASEBATTLE_EXPIRY })
			.sAdd(this.getKey("server", data.server_id), data.id)
			.sAdd("casebattles:global", data.id)
			.set(playerKey, data.id, { EX: CASEBATTLE_EXPIRY })
			.exec();

		if (!result || result.some((reply) => !reply)) {
			await this.redis.del([lockKey, casebattleKey, playerKey]);
			return false;
		}

		return true;
	}

	async joinCaseBattle(casebattleId: string, newPlayer: CaseBattleData["players"][number]): Promise<boolean> {
		const MAX_RETRIES = 3;
		const RETRY_DELAY_MS = 100;

		const gameKey = this.getKey("game", casebattleId);

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
					.exec();

				if (execRes && !execRes.some((r) => !r)) {
					return true;
				}

				await this.delay(RETRY_DELAY_MS);
			} catch (err) {
				await this.redis.unwatch();
				console.error(`Error joining casebattle: ${err}`);
				await this.delay(RETRY_DELAY_MS);
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
		const playerKey = this.getKey("player", data.players[0].id);
		const serverKey = this.getKey("server", data.server_id);

		const multi = this.redis
			.multi()
			.del([gameKey])
			.del([playerKey])
			.sRem(serverKey, id)
			.sRem("casebattles:global", id);

		if (data.players.length > 1) {
			data.players.forEach((player) => {
				this.redis.del(this.getKey("player", player.id));
			});
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
		// Use a short-lived lock to ensure this method only runs once per battle.
		// The full execution of a battle can take a long time, but we only need
		// mutual exclusion for the critical section that flips the state from
		// "waiting_for_players" to "in_progress". Once that is done any later
		// callers will see the updated status and bail out immediately.
		const lockKey = this.getKey("start-lock", id);
		const gotLock = await this.acquireLock(lockKey, 30); // 30 seconds should be enough for the critical section
		if (!gotLock) return false;

		try {
			const gameKey = this.getKey("game", id);
			const currentGame = await this.redis.get(gameKey);
			if (!currentGame) {
				await this.releaseLock(lockKey);
				return false;
			}

			let current: CaseBattleData = JSON.parse(currentGame);
			if (current.status !== "waiting_for_players") {
				await this.releaseLock(lockKey);
				return false;
			}

			await this.redis.set(
				gameKey,
				JSON.stringify({ ...current, status: "in_progress", started_at: Date.now(), updated_at: Date.now() }),
				{
					XX: true,
					EX: CASEBATTLE_EXPIRY,
				},
			);

			// Release the lock early so that other operations are unblocked while the
			// lengthy battle simulation runs. Subsequent callers will see the status
			// has changed to "in_progress" and will therefore return early.
			await this.releaseLock(lockKey);

			for (const [index, caseId] of current.cases.entries()) {
				const [caseData] = await this.getCases(caseId);
				if (!caseData) return false;
				const currentGameData = await this.redis.get(gameKey);
				if (!currentGameData) return false;
				current = JSON.parse(currentGameData);

				for (const player of current.players) {
					const { result, hash, roll } = randomCaseBattleSpin(
						caseData.items,
						player.client_seed,
						current.server_seed,
						index,
					);

					if (!current.player_pulls[player.id])
						current.player_pulls[player.id] = { items: [], total_value: 0 };
					current.player_pulls[player.id].items.push({
						id: result.id,
						roll: roll,
						hash: hash,
						case_index: index,
						value: result.value,
					});
					current.player_pulls[player.id].total_value += result.value;
				}

				current.current_spin_data.current_case_index = index;
				current.current_spin_data.case_id = caseId;
				current.current_spin_data.progress = `${index + 1}/${current.cases.length}`;
				await this.redis.set(gameKey, JSON.stringify({ ...current, updated_at: Date.now() }), {
					XX: true,
					EX: CASEBATTLE_EXPIRY,
				});

				await this.delay((current.fast_mode ? 3 : 5) * 1000 + 300);
			}

			let winningPlayers: { player_id: string; amount_won: number }[] = [];
			if (current.mode === "Group") {
				winningPlayers = groupModeHandler(current);
			} else if (current.mode === "Randomized") {
				winningPlayers = randomizerModeHandler(current);
			} else if (current.mode === "Showdown") {
				winningPlayers = showdownModeHandler(current);
			} else if (current.mode === "Standard") {
				winningPlayers = standardModeHandler(current);
			}

			// Update each player's total_value to reflect their final winnings (amount won or 0 if they lost)
			const winningsMap: Record<string, number> = winningPlayers.reduce((acc, { player_id, amount_won }) => {
				acc[player_id] = amount_won;
				return acc;
			}, {} as Record<string, number>);
			for (const player of current.players) {
				if (current.player_pulls[player.id]) {
					current.player_pulls[player.id].total_value = winningsMap[player.id] ?? 0;
				}
			}

			await this.redis.set(
				gameKey,
				JSON.stringify({
					...current,
					winners_info: winningPlayers,
					completed_at: Date.now(),
					status: "completed",
					updated_at: Date.now(),
					current_spin_data: {
						...current.current_spin_data,
						current_case_index: current.cases.length + 1,
					},
				}),
				{
					XX: true,
					EX: 10,
				},
			);

			const pgClient = await getPostgresConnection();
			const values = winningPlayers
				.filter((player) => !player.player_id.startsWith("bot_"))
				.map((player) => [player.player_id, player.amount_won]);
			if (values.length > 0) {
				const placeholders = values.map((_, idx) => `($${idx * 2 + 1}, $${idx * 2 + 2}, 'pending')`).join(", ");
				await pgClient.query(
					`INSERT INTO external_cash_change_requests (user_id, amount, status) VALUES ${placeholders}`,
					values.flat(),
				);
			}
			await pgClient.release();

			return true;
		} finally {
			await this.releaseLock(lockKey);
		}
	}
}
