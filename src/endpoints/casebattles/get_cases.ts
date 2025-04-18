import { getMariaConnection } from "../../service/mariadb";
import smartQuery from "../../utilities/smartQuery";

interface CaseRow {
	id: number;
	name: string;
	currency: string;
	category: string;
	price: number;
	image: string;
	hex: string;
}

interface ItemRow {
	id: number;
	case_id: number;
	asset_id: number;
	chance: number;
	value: number;
}

export default async function (): Promise<[number, any]> {
	const connection = await getMariaConnection();
	if (!connection) {
		return [500, { error: "failed to connect to the database" }];
	}

	try {
		const cases: CaseRow[] = await smartQuery(connection, "SELECT * FROM virtual_cases");
		const items: ItemRow[] = await smartQuery(connection, "SELECT * FROM virtual_case_items");

		const caseItems: Record<number, ItemRow[]> = {};
		for (const item of items) {
			if (!caseItems[item.case_id]) caseItems[item.case_id] = [];
			caseItems[item.case_id].push(item);
		}

		const result = cases.map((c) => ({
			...c,
			items: caseItems[c.id] || [],
		}));

		return [200, { status: "OK", data: result }];
	} catch (error) {
		console.error("error fetching cases and items:", error);
		return [500, { error: "internal server error" }];
	} finally {
		await connection.release();
	}
}
