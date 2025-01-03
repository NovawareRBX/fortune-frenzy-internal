import { getMariaConnection } from "../service/mariadb";
import query from "./smartQuery";

export default async function (uaids: string[]): Promise<number> {
    const connection = await getMariaConnection();
    if (!connection) {
        return 0;
    }

	try {
		const itemIds = uaids.map((uaid) => uaid.split(":")[1]);
		const items = await query(connection, `SELECT value FROM items WHERE id IN (?)`, [itemIds]);
		const totalValue = items.reduce((sum: number, item: { value: number }) => sum + item.value, 0);

		return totalValue;
	} catch (error) {
        console.error(error);
        return 0;
    } finally {
        connection.release();
    }
}
