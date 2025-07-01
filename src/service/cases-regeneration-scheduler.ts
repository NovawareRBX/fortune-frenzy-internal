import { FastifyInstance } from "fastify";
import { getPostgresConnection } from "./postgres";
import internalRequest from "../utilities/internalRequest";
import { getRedisConnection } from "./redis";

let timeoutHandle: NodeJS.Timeout | null = null;
let isRunning = false;

async function scheduleNextRun(server: FastifyInstance, delayMs: number): Promise<void> {
	if (timeoutHandle) clearTimeout(timeoutHandle);
	timeoutHandle = setTimeout(() => runCaseRegenerationScheduler(server).catch(() => {}), delayMs);
}

export async function runCaseRegenerationScheduler(server: FastifyInstance): Promise<void> {
	if (isRunning) return;
	isRunning = true;

	let connection;
	try {
		connection = await getPostgresConnection();

		const { rows } = await connection.query(
			"SELECT next_rotation FROM cases ORDER BY next_rotation ASC LIMIT 1",
		);

		if (rows.length === 0) {
			await scheduleNextRun(server, 60_000 * 60);
			return;
		}

		const nextRotationTime = new Date(rows[0].next_rotation).getTime();
		const now = Date.now();
		const delayMs = nextRotationTime - now;

		if (delayMs > 0) {
			await scheduleNextRun(server, delayMs);
		} else {
			const redis = await getRedisConnection();
			const lockKey = "cases:regeneration:lock";
			const haveLock = await redis.set(lockKey, "1", { NX: true, EX: 60 });
			if (!haveLock) {
				await scheduleNextRun(server, 5_000);
			} else {
				try {
					const res = await internalRequest(server, { method: "POST", url: "/cases/regenerate" });
					const status = res.statusCode;
					if (status !== 200) {
						server.log.error(
							`[CaseRegenerationScheduler] regenerate endpoint responded with status ${status}`,
						);
					}
				} finally {
					await redis.del(lockKey);
				}
				await scheduleNextRun(server, 1_000);
			}
		}
	} catch (err) {
		console.error("[CaseRegenerationScheduler] error", err);
		await scheduleNextRun(server, 30_000);
	} finally {
		if (connection) connection.release();
		isRunning = false;
	}
}

export default runCaseRegenerationScheduler; 