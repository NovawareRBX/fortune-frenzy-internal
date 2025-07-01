import { FastifyInstance } from "fastify";
import { getRedisConnection } from "../redis";
import { JackpotRedisManager } from "./jackpot-redis";

export async function runJackpotScheduler(server: FastifyInstance): Promise<void> {
	const redis = await getRedisConnection();
	const jackpotManager = new JackpotRedisManager(redis, server);

	const nowMs = Date.now();

	let ids: string[] = [];
	try {
		ids = await jackpotManager.getActiveJackpots();
	} catch (err) {
		console.error("[JackpotScheduler] failed to fetch active jackpot IDs", err);
		return;
	}

	for (const id of ids) {
		let pot;
		try {
			pot = await jackpotManager.getJackpot(id);
		} catch (err) {
			console.error(`[JackpotScheduler] failed to fetch jackpot ${id}`, err);
			continue;
		}

		if (!pot) continue;

		if (
			pot.status === "waiting_for_start" &&
			pot.auto_start_at !== undefined &&
			pot.auto_start_at <= nowMs
		) {
			await jackpotManager.startJackpot(id).catch((err) =>
				console.error(`[JackpotScheduler] auto-start error for jackpot ${id}:`, err),
			);
			continue;
		}

		if (
			pot.status === "countdown" &&
			pot.countdown_end_at !== -1 &&
			pot.countdown_end_at <= nowMs
		) {
			await jackpotManager.finalizeJackpot(id).catch((err) =>
				console.error(`[JackpotScheduler] finalize error for jackpot ${id}:`, err),
			);
			continue;
		}

		if (pot.status === "complete") {
			const elapsedMs = Date.now() - pot.updated_at;
			if (elapsedMs >= 30_000) {
				await Promise.all([
					redis.sRem("jackpots:global", id),
					redis.sRem(`jackpot:server:${pot.server_id}`, id),
				]).catch((err) =>
					console.error(`[JackpotScheduler] cleanup error for jackpot ${id}:`, err),
				);
			}
		}
	}
}

export default runJackpotScheduler; 