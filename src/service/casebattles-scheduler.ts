import { FastifyInstance } from "fastify";
import { getRedisConnection } from "./redis";
import { CasebattlesRedisManager } from "./casebattles-redis";

export async function runCaseBattleScheduler(server: FastifyInstance): Promise<void> {
	const redis = await getRedisConnection();
	const casebattleManager = new CasebattlesRedisManager(redis, server);

	const nowMs = Date.now();

	let ids: string[] = [];
	try {
		ids = await casebattleManager.getActiveCaseBattles();
	} catch (err) {
		console.error("[CaseBattleScheduler] failed to fetch active case battle IDs", err);
		return;
	}

	for (const id of ids) {
		let battle;
		try {
			battle = await casebattleManager.getCaseBattle(id);
		} catch (err) {
			console.error(`[CaseBattleScheduler] failed to fetch case battle ${id}`, err);
			continue;
		}

		if (!battle) continue;

		const maxPlayers = battle.team_mode
			.split("v")
			.map((n) => parseInt(n, 10))
			.reduce((sum, n) => sum + n, 0);

		if (battle.status === "waiting_for_players" && battle.players.length === maxPlayers) {
			await casebattleManager
				.startCaseBattle(id)
				.catch((err) => console.error(`[CaseBattleScheduler] start error for case battle ${id}:`, err));
			continue;
		}

		if (battle.status === "in_progress") {
			await casebattleManager
				.stepCaseBattle(id)
				.catch((err) => console.error(`[CaseBattleScheduler] step error for case battle ${id}:`, err));
			continue;
		}

		if (battle.status === "completed") {
			const elapsed = nowMs - battle.updated_at;
			if (elapsed >= 30_000) {
				await Promise.all([
					redis.sRem("casebattles:global", id),
					redis.sRem(`casebattle:server:${battle.server_id}`, id),
				]).catch((err) =>
					console.error(`[CaseBattleScheduler] cleanup error for case battle ${id}:`, err),
				);
			}
		}
	}
}

export default runCaseBattleScheduler; 