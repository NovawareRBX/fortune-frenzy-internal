import { getPostgresConnection } from "../../service/postgres";
import { ItemCase } from "../../types/Endpoints";

const ITEMS_PER_CASE = 10;

function fisherYatesShuffle<T>(array: T[]): void {
	for (let i = array.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[array[i], array[j]] = [array[j], array[i]];
	}
}

function selectCaseItems(
	validItems: { id: string; value: number }[],
	minValue: number,
	maxValue: number,
	usedItemIds: Set<string>,
): { id: string; value: number }[] {
	const eligibleItems = validItems.filter(
		(item) => item.value >= minValue && item.value <= maxValue && !usedItemIds.has(item.id),
	);

	fisherYatesShuffle(eligibleItems);
	const selectedItems = eligibleItems.slice(0, ITEMS_PER_CASE);
	selectedItems.forEach((item) => usedItemIds.add(item.id));
	return selectedItems;
}

function calculateCasePrice(items: { id: string; value: number }[], itemChances: number[]): number {
	const sortedItems = [...items].sort((a, b) => a.value - b.value);
	const middleIndex = Math.floor(ITEMS_PER_CASE / 2);
	const middleValue = sortedItems[middleIndex].value;
	const highValueThreshold = middleValue * 5;
	const highValueItems = items.filter((item) => item.value >= highValueThreshold);

	const hasLowProbHighValue = highValueItems.some((item, index) => {
		const chance = itemChances[items.indexOf(item)];
		return chance < 5;
	});

	const discount = hasLowProbHighValue ? 0.7 : 0.8;

	const price = Math.round(middleValue * discount);

	return price;
}

function calculateItemChances(
	items: { id: string; value: number }[],
): { id: string; chance: number; claimed: number }[] {
	const EPSILON = 1e-9;
	const rawWeights = items.map((item) => 1 / (item.value + EPSILON));
	const sumRaw = rawWeights.reduce((acc, w) => acc + w, 0);
	const chances = rawWeights.map((w) => (w / sumRaw) * 100);

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
	let items = selectCaseItems(validItems, currentCase.min_value, currentCase.max_value, usedItemIds);

	const currentIndex = sortedCases.findIndex((c) => c.id === currentCase.id);
	let i = currentIndex - 1;
	while (items.length < ITEMS_PER_CASE && i >= 0) {
		const lowerCase = sortedCases[i];
		const { rows: fillerCandidatesRows } = await connection.query(
			"SELECT id, value FROM items WHERE value >= $1 AND value <= $2",
			[lowerCase.min_value, lowerCase.max_value],
		);
		let fillerCandidates = fillerCandidatesRows as { id: string; value: number }[];
		fillerCandidates = fillerCandidates.filter((item: { id: string; value: number }) => !usedItemIds.has(item.id));
		fisherYatesShuffle(fillerCandidates);

		const slotsLeft = ITEMS_PER_CASE - items.length;
		const fillers = fillerCandidates.slice(0, slotsLeft);
		items.push(...fillers);
		fillers.forEach((item) => usedItemIds.add(item.id));
		i--;
	}

	if (items.length < ITEMS_PER_CASE) {
		throw new Error(`Not enough items to fill case ${currentCase.id}. Only found ${items.length} items.`);
	}

	fisherYatesShuffle(items);
	return items;
}

export default {
	method: "POST",
	url: "/cases/regenerate",
	authType: "key",
	callback: async function(): Promise<[number, any]> {
		const connection = await getPostgresConnection();
		if (!connection) {
			console.error("database connection failed");
			return [500, { error: "failed to establish database connection" }];
		}

		try {
			const { rows: casesRows } = await connection.query("SELECT * FROM cases");
			const cases = casesRows as ItemCase[];
			cases.sort((a, b) => a.min_value - b.min_value);

			const usedItemIds = new Set<string>();

			for (let i = 0; i < cases.length; i++) {
				const caseData = cases[i];
				const { rows: validItemsRows } = await connection.query(
					"SELECT id, value FROM items WHERE value >= $1 AND value <= $2",
					[caseData.min_value, caseData.max_value],
				);
				const validItems = validItemsRows as { id: string; value: number }[];

				const items = await selectCaseItemsWithFillers(connection, caseData, validItems, usedItemIds, cases);
				const caseItemsWithChances = calculateItemChances(items);
				const chances = caseItemsWithChances.map((item: {id:string; chance:number; claimed:number}) => item.chance);
				const calculatedPrice = calculateCasePrice(items, chances);

				await connection.query(
					"UPDATE cases SET items = $1, price = $2, next_rotation = $3, opened_count = 0 WHERE id = $4",
					[
						JSON.stringify(caseItemsWithChances),
						calculatedPrice,
						new Date(Date.now() + 1000 * 60 * 60 * 24 * 3),
						caseData.id,
					],
				);
			}

			return [200, { success: true }];
		} catch (error) {
			console.error("error regenerating cases:", error);
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
};
