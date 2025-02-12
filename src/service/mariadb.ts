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
	});
}

export async function getMariaConnection() {
	if (!pool) {
		initalise();
	}

	return pool.getConnection();
}
