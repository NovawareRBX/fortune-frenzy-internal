import { getPostgresConnection } from "../service/postgres";

export default async function (uaids: string[]): Promise<number> {
	const connection = await getPostgresConnection();
	if (!connection) return 0;
	if (uaids.length === 0) return 0;

	try {
		// Extract the numeric item IDs from the UAIDs and filter out any malformed entries
		const itemIds = uaids
			.map((uaid) => {
				const idPart = uaid.split(":" /* UAID format is <prefix>:<itemId> */).pop();
				const id = idPart ? parseInt(idPart, 10) : NaN;
				return Number.isNaN(id) ? null : id;
			})
			.filter((id): id is number => id !== null);

		if (itemIds.length === 0) return 0;

		// Use the ANY operator to safely match against the array of IDs
		const items = await connection.query<{ value: number }>(
			`SELECT value FROM items WHERE id = ANY($1::bigint[])`,
			[itemIds],
		);
		const totalValue = items.rows.reduce((sum: number, item: { value: number }) => sum + item.value, 0);

		return totalValue;
	} catch (error) {
		console.error(error);
		return 0;
	} finally {
		connection.release();
	}
}
