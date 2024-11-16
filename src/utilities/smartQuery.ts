import { PoolConnection } from "mariadb";

export default async function <T = any>(connection: PoolConnection, query: string, params?: any[]): Promise<T> {
	const result = connection.query(query, params) as Promise<any[]>;

	return result.then((rows: any[]) => {
		return rows.map((row) => {
			for (const key in row) {
				if (typeof row[key] === "bigint") {
					row[key] = row[key].toString();
				} else if (typeof row[key] === "string") {
					try {
						row[key] = JSON.parse(row[key]);
					} catch (e) {}
				}
			}

			return row;
		});
	}) as T;
}
