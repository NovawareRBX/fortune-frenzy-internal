import { getMariaConnection } from "../../service/mariadb";
import { ItemCase } from "../../types/Endpoints";
import smartQuery from "../../utilities/smartQuery";

const ITEMS_PER_CASE = 10;
function fisherYatesShuffle<T>(array: T[]): void {
	for (let i = array.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[array[i], array[j]] = [array[j], array[i]];
	}
}

function selectCaseItems(
	validItems: { id: string; value: number }[],
	casePrice: number,
	usedItemIds: Set<string>,
): { id: string; value: number }[] {
	const highTier: { id: string; value: number }[] = [];
	const lowerTier: { id: string; value: number }[] = [];
	const backup: { id: string; value: number }[] = [];

	for (const item of validItems) {
		if (usedItemIds.has(item.id)) continue;
		if (item.value >= casePrice) {
			highTier.push(item);
		} else if (item.value >= casePrice * 0.5) {
			lowerTier.push(item);
		} else {
			backup.push(item);
		}
	}

	fisherYatesShuffle(highTier);
	fisherYatesShuffle(lowerTier);
	fisherYatesShuffle(backup);

	const items: { id: string; value: number }[] = [];
	const desiredHigh = Math.min(Math.floor(ITEMS_PER_CASE * 0.7), highTier.length);
	items.push(...highTier.slice(0, desiredHigh));

	const remainingAfterHigh = ITEMS_PER_CASE - items.length;
	const desiredLower = Math.min(remainingAfterHigh, lowerTier.length);
	items.push(...lowerTier.slice(0, desiredLower));

	const remainingAfterLower = ITEMS_PER_CASE - items.length;
	if (remainingAfterLower > 0) {
		items.push(...backup.slice(0, remainingAfterLower));
	}

	fisherYatesShuffle(items);
	return items;
}

function calculateItemChances(items: { id: string; value: number }[], casePrice: number, targetProfitPct = 30) {
	const EPSILON = 1e-9;
	let sumValues = 0;
	for (const item of items) {
		sumValues += item.value;
	}

	const rawWeights = items.map((it) => sumValues / (it.value + EPSILON));
	const sumRaw = rawWeights.reduce((acc, w) => acc + w, 0);
	let chances = rawWeights.map((w) => (w / sumRaw) * 100);

	const isProfit = (value: number) => value >= casePrice;
	const profitChance = items.reduce((acc, it, i) => (isProfit(it.value) ? acc + chances[i] : acc), 0);

	if (Math.abs(profitChance - targetProfitPct) < 0.01) {
		const oldNonProfit = 100 - profitChance;
		if (oldNonProfit > 0) {
			const newNonProfit = 100 - targetProfitPct;
			const factor = newNonProfit / oldNonProfit;
			for (let i = 0; i < items.length; i++) {
				if (!isProfit(items[i].value)) {
					chances[i] *= factor;
				}
			}
			const sumNow = chances.reduce((acc, c) => acc + c, 0);
			chances = chances.map((c) => (c / sumNow) * 100);
		}
	}

	return items.map((item, i) => ({
		id: item.id,
		chance: Math.max(Number(chances[i].toFixed(5)), 0.00001),
		claimed: 0,
	}));
}

async function selectCaseItemsWithFillers(
	connection: any,
	currentCase: ItemCase,
	validItems: { id: string; value: number }[],
	usedItemIds: Set<string>,
	sortedCases: ItemCase[],
): Promise<{ id: string; value: number }[]> {
	let items = selectCaseItems(validItems, currentCase.price, usedItemIds);
	items.forEach((item) => usedItemIds.add(item.id));

	const currentIndex = sortedCases.findIndex((c) => c.id === currentCase.id);
	let i = currentIndex - 1;
	while (items.length < ITEMS_PER_CASE && i >= 0) {
		const lowerCase = sortedCases[i];
		let fillerCandidates: { id: string; value: number }[] = await smartQuery(
			connection,
			"SELECT id, value FROM items WHERE value > ? AND value < ?",
			[lowerCase.min_value, lowerCase.max_value],
		);
		fillerCandidates = fillerCandidates.filter((item) => !usedItemIds.has(item.id));
		fisherYatesShuffle(fillerCandidates);
		const slotsLeft = ITEMS_PER_CASE - items.length;
		const fillers = fillerCandidates.slice(0, slotsLeft);
		items.push(...fillers);
		fillers.forEach((item) => usedItemIds.add(item.id));
		i--;
	}

	fisherYatesShuffle(items);
	return items;
}

export default async function regenerate_cases(): Promise<[number, any]> {
	const connection = await getMariaConnection();
	if (!connection) {
		console.error("database connection failed");
		return [500, { error: "failed to establish database connection" }];
	}

	try {
		const cases = await smartQuery<ItemCase[]>(connection, "SELECT * FROM cases");
		cases.sort((a, b) => a.price - b.price);

		const used_item_ids = new Set<string>();

		for (let i = 0; i < cases.length; i++) {
			const case_data = cases[i];
			const valid_items = await smartQuery<{ id: string; value: number }[]>(
				connection,
				"SELECT id, value FROM items WHERE value > ? AND value < ?",
				[case_data.min_value, case_data.max_value],
			);

			const items = await selectCaseItemsWithFillers(connection, case_data, valid_items, used_item_ids, cases);
			const case_items = calculateItemChances(items, case_data.price);

			await connection.query("UPDATE cases SET items = ?, next_rotation = ?, opened_count = 0 WHERE id = ?", [
				JSON.stringify(case_items),
				new Date(Date.now() + 1000 * 60 * 60 * 24 * 3),
				case_data.id,
			]);
		}

		return [200, { success: true }];
	} catch (error) {
		console.error("error fetching cases:", error);
		return [
			500,
			{
				error: "internal server error",
				details: error instanceof Error ? error.message : "unknown error",
			},
		];
	} finally {
		connection.release();
	}
}
