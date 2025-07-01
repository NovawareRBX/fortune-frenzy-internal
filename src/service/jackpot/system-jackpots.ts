import { FastifyInstance } from "fastify";
import { getRedisConnection } from "../redis";
import { JackpotRedisManager } from "./jackpot-redis";
import { generateServerSeed } from "../../utilities/secureRandomness";

export async function ensureSystemJackpots(server: FastifyInstance): Promise<void> {
	const redis = await getRedisConnection();
	const jackpotManager = new JackpotRedisManager(redis, server);

	const VALUE_CAPS = [
		100_000,
		250_000,
		1_000_000,
		5_000_000,
		10_000_000,
		50_000_000,
		100_000_000,
		Number.MAX_SAFE_INTEGER,
	] as const;

	for (const cap of VALUE_CAPS) {
		const capTag = cap === Number.MAX_SAFE_INTEGER ? "inf" : cap.toString();
		const initLockKey = `jackpot:init_lock:system:${capTag}`;
		const gotLock = await redis.set(initLockKey, "1", { NX: true, EX: 5 });
		if (!gotLock) continue;

		let existingActive: Awaited<ReturnType<typeof jackpotManager.getJackpot>> | null = null;
		try {
			const activeIds = await jackpotManager.getActiveJackpots("system");
			for (const aid of activeIds) {
				if (!aid.startsWith(`system_${capTag}_`)) continue;
				const pot = await jackpotManager.getJackpot(aid);
				if (pot && pot.status !== "complete") {
					existingActive = pot;
					break;
				}
			}
		} catch (_) {}

		if (
			!existingActive ||
			(existingActive.status === "complete" && existingActive.updated_at < Date.now() - 5_000)
		) {
			const uniqueSuffix = `${Date.now().toString(36)}${Math.random().toString(36).substring(2, 8)}`;
			const potId = `system_${capTag}_${uniqueSuffix}`;
			const created = await jackpotManager.createJackpot({
				id: potId,
				server_id: "system",
				server_seed: generateServerSeed(),
				creator: { id: `system_creator_${potId}`, username: "System", display_name: "System" },
				value_cap: cap,
				joinable: true,
				leaveable: true,
				status: "waiting_for_start",
				members: [],
				countdown_end_at: -1,
				created_at: Date.now(),
				updated_at: Date.now(),
				is_system_pot: true,
				max_players: 64,
			});

			if (created) {
				await redis.expire(`jackpot:game:${potId}`, 500);
			}
		}

		await redis.del(initLockKey);
	}
}

export default ensureSystemJackpots;
