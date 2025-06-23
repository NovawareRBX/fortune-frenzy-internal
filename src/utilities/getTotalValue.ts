import { getPostgresConnection } from "../service/postgres";

export default async function (uaids: string[]): Promise<number> {
	const connection = await getPostgresConnection();
	if (!connection) return 0;
	if (uaids.length === 0) return 0;

	try {
		const itemIds = uaids.map((uaid) => uaid.split(":")[1]);
		const items = await connection.query<{ value: number }>(`SELECT value FROM items WHERE id IN ($1)`, [itemIds]);
		const totalValue = items.rows.reduce((sum: number, item: { value: number }) => sum + item.value, 0);

		return totalValue;
	} catch (error) {
		console.error(error);
		return 0;
	} finally {
		connection.release();
	}
}
