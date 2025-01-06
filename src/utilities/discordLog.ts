import { getRedisConnection } from "../service/redis";

export default async function (
	priority: "Log" | "Warning" | "Danger" | "EmergencyWakeTheFuckUpNow",
	title: string,
	description: string,
): Promise<void> {
	const redis = await getRedisConnection();
	if (!redis) return;
	await redis.publish("api_discord_log", JSON.stringify({ title, description, priority }));
}
