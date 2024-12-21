import query from "./smartQuery";

export default async function (connection: any, uaids: string[]): Promise<string> {
	const items = await query<Array<{ item_id: string; user_asset_id: string }>>(
		connection,
		`SELECT item_id, user_asset_id FROM item_copies WHERE user_asset_id IN (?)`,
		[uaids],
	);
	return items.map((item) => `${item.user_asset_id}:${item.item_id}`).join(",");
}
