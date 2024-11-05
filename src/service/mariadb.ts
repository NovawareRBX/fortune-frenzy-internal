import mariadb from "mariadb";

let pool: mariadb.Pool;

function initalise(): void {
	pool = mariadb.createPool({
		host: "172.18.0.6",
		port: 6033,
		user: process.env.MARIADB_USER,
		password: process.env.MARIADB_PASSWORD,
		database: "Game1",
		connectionLimit: 30,
	});
}

export async function getMariaConnection() {
	if (!pool) {
		console.log("Initialising MariaDB pool");
		initalise();
		console.log("Initialised MariaDB pool");
	}

	return pool.getConnection();
}
