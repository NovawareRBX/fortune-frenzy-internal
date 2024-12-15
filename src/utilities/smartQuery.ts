import { isArray } from "lodash";
import { PoolConnection } from "mariadb";

interface QueryOptions {
	parseJson?: boolean;
	stringifyBigInt?: boolean;
}

export default async function query<T = any>(
	connection: PoolConnection,
	query: string,
	params?: any[],
	options: QueryOptions = { parseJson: true, stringifyBigInt: true },
): Promise<T> {
	const result: Promise<any[]> = connection.query(query, params);

	return result.then((rows: any[]) => {
		if (!isArray(rows)) {
			return rows;
		}

		return rows.map((row) => {
			for (const [key, value] of Object.entries(row)) {
				if (options.stringifyBigInt && typeof value === "bigint") {
					row[key] = value.toString();
				} else if (options.parseJson && typeof value === "string" && isNaN(Number(value))) {
					try {
						row[key] = JSON.parse(value);
					} catch {}
				}
			}
			return row;
		});
	}) as T;
}
