import { PoolClient } from "pg";

export default async function (
	connection: PoolClient,
	uaids: string[],
): Promise<{ item_id: string; owner_id: number; user_asset_id: string }[]> {
	const { rows } = await connection.query<{ item_id: string; owner_id: string; user_asset_id: string }>(
		`SELECT item_id, owner_id, user_asset_id FROM item_copies WHERE user_asset_id = ANY($1::text[])`,
		[uaids],
	);

	return rows.map((row) => ({ item_id: row.item_id, owner_id: parseInt(row.owner_id), user_asset_id: row.user_asset_id }));
}
