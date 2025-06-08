import { createClient, RedisClientType } from "redis";

let client: RedisClientType;

async function initialize(): Promise<void> {
	client = createClient({
		password: process.env.REDIS_PASSWORD,
		socket: {
			host: "Redis",
			port: 6379,
			tls: false,
		},
		database: 0,
		commandsQueueMaxLength: 0,
		// enableAutoPipelining: true,
	});

	client.on("error", (error) => {
		console.error("Redis Client Error:", error);
	});

	await client.connect();
}

export async function getRedisConnection(): Promise<RedisClientType> {
	if (!client) {
		await initialize();
	}

	return client;
}
