import mariadb from "mariadb";

let pool: mariadb.Pool;

function initalise(): void {
	pool = mariadb.createPool({
		host: "proxysql",
		port: 6033,
		user: process.env.MARIADB_USER,
		password: process.env.MARIADB_PASSWORD,
		database: "Game1",
		connectionLimit: 50,
		autoJsonMap: true,
		keepAliveDelay: 60000,
		acquireTimeout: 30000,
		connectTimeout: 20000,
		idleTimeout: 60000,
	});
}

export async function getMariaConnection() {
	if (!pool) {
		initalise();
	}

	try {
		return await pool.getConnection();
	} catch (error) {
		console.error("Failed to get MariaDB connection:", error);
		throw new Error("Database connection failed");
	}
}
