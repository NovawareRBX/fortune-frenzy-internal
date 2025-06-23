import { createClient, ClickHouseClient } from "@clickhouse/client";

let client: ClickHouseClient;

async function initialize(): Promise<void> {
    client = createClient({
        url: "http://clickhouse:18123",
        username: process.env.CLICKHOUSE_USER,
        password: process.env.CLICKHOUSE_PASSWORD,
        database: "default"
    });
}

export async function getClickhouseConnection(): Promise<ClickHouseClient> {
    if (!client) await initialize()
    return client;
}