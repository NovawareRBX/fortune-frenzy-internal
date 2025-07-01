import { Pool, PoolClient } from "pg";

type DatabaseName = "fortunefrenzy";

const credentials: Record<DatabaseName, [string?, string?]> = {
	fortunefrenzy: [process.env.FF_POSTGRES_USER, process.env.FF_POSTGRES_PASSWORD],
};

const pools: Partial<Record<DatabaseName, Pool>> = {};

function initializePool(database: DatabaseName): void {
	const [user, password] = credentials[database] ?? [];
	if (!user || !password) {
		throw new Error(`missing credentials for ${database}`);
	}

	// Avoid logging sensitive information such as the database password
	console.log("[postgres] Initializing pool for", database, "as user", user);

	const pool = new Pool({
		host: "pgbouncer",
		port: 6432,
		user,
		password,
		database,
		max: 20,
		connectionTimeoutMillis: 3000,
	});

	pools[database] = pool;
}

export async function getPostgresConnection(database: DatabaseName = "fortunefrenzy") {
	if (!pools[database]) initializePool(database);

	const client = await pools[database]!.connect();
	return client as PoolClient;
}
