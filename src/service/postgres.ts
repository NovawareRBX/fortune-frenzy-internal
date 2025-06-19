import { Pool } from "pg";

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

	console.log("initializing pool for", database, "with user", user, "and password", password);

	pools[database] = new Pool({
		host: "pgbouncer",
		port: 6432,
		user,
		password,
		database,
		max: 5,
		connectionTimeoutMillis: 1000,
	});
}

export async function getPostgresConnection(database: DatabaseName = "fortunefrenzy") {
	if (!pools[database]) initializePool(database);
	return pools[database]!.connect();
}
