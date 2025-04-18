import mariadb from "mariadb";

let pools: { [key: string]: mariadb.Pool } = {};
type DatabaseName = "NovawareDiscord" | "Game1";

const credentials = {
	NovawareDiscord: [process.env.DISCORD_MARIADB_USER, process.env.DISCORD_MARIADB_PASSWORD],
	Game1: [process.env.GAME1_MARIADB_USER, process.env.GAME1_MARIADB_PASSWORD],
};

function initializePool(database: DatabaseName): void {
	if (credentials[database] === undefined) {
		console.error(`No credentials found for ${database}`);
		return;
	}

	pools[database] = mariadb.createPool({
		host: "172.18.0.4",
		port: 6033,
		user: credentials[database][0],
		password: credentials[database][1],
		database: database,
		connectionLimit: 30,
	});
}

export async function getMariaConnection(database: DatabaseName = "Game1") {
	if (!pools[database]) {
		initializePool(database);
	}
	return pools[database].getConnection();
}
