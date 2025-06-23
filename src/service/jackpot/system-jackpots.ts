import { FastifyInstance } from "fastify";
import { getRedisConnection } from "../redis";
import { JackpotRedisManager } from "./jackpot-redis";
import { generateServerSeed } from "../../utilities/secureRandomness";

/**
 * Creates (if absent) a set of system jackpot pots with predefined value caps.
 * These pots sit in a waiting state until players join. Once the first
 * participant joins, the pot will automatically start after 2 minutes.
 */
export async function ensureSystemJackpots(server: FastifyInstance): Promise<void> {
	const redis = await getRedisConnection();
	const jackpotManager = new JackpotRedisManager(redis, server);

	const VALUE_CAPS = [
		100_000,
		500_000,
		1_000_000,
		5_000_000,
		10_000_000,
		50_000_000,
		100_000_000,
		500_000_000,
		Number.MAX_SAFE_INTEGER,
	] as const;

	for (const cap of VALUE_CAPS) {
		const potId = `system_${cap === Number.MAX_SAFE_INTEGER ? "inf" : cap}`;

		// Avoid duplicate creation attempts from multiple worker processes
		const initLockKey = `jackpot:init_lock:${potId}`;
		const gotLock = await redis.set(initLockKey, "1", { NX: true, EX: 5 });
		if (!gotLock) {
			continue; // another process is handling this pot
		}

		const existing = await jackpotManager.getJackpot(potId);

		if (!existing || existing.status === "complete") {
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
				starting_at: -1,
				created_at: Date.now(),
				updated_at: Date.now(),
				is_system_pot: true,
			});

			// Extend the TTL for system pots to 24 hours to reduce chance of accidental expiry
			if (created) {
				await redis.expire(`jackpot:game:${potId}`, 86_400);
			}

			// Release lock early (not strictly necessary because of EX) to allow retries if needed
			await redis.del(initLockKey);
		}
	}
}

export default ensureSystemJackpots; 