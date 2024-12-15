import { getMariaConnection } from "../../service/mariadb";
import { ItemCase } from "../../types/Endpoints";
import smartQuery from "../../utilities/smartQuery";

const UI_DATA = [
	{ primary: "rbxassetid://15807807517", secondary: "rbxassetid://16301287999", colour: "#8585a5" },
	{ primary: "rbxassetid://15798873667", secondary: "rbxassetid://16301286870", colour: "#a262a5" },
	{ primary: "rbxassetid://15798906620", secondary: "rbxassetid://16301286347", colour: "#a54c4d" },
	{ primary: "rbxassetid://15800082300", secondary: "rbxassetid://16301285796", colour: "#814ba3" },
	{ primary: "rbxassetid://15800099099", secondary: "rbxassetid://16301285182", colour: "#46a566" },
	{ primary: "rbxassetid://15800151046", secondary: "rbxassetid://16301284803", colour: "#6d529d" },
	{ primary: "rbxassetid://15800171273", secondary: "rbxassetid://16301284324", colour: "#54a044" },
	{ primary: "rbxassetid://15800196659", secondary: "rbxassetid://16301283938", colour: "#4b8b9b" },
	{ primary: "rbxassetid://15800221411", secondary: "rbxassetid://16301283554", colour: "#a03b83" },
	{ primary: "rbxassetid://15800256140", secondary: "rbxassetid://16301283113", colour: "#53509f" },
	{ primary: "rbxassetid://15800299961", secondary: "rbxassetid://16301282541", colour: "#a5858a" },
	{ primary: "rbxassetid://15800317702", secondary: "rbxassetid://16301281925", colour: "#534545" },
	{ primary: "rbxassetid://15800343558", secondary: "rbxassetid://16301281534", colour: "#8b8b8b" },
	{ primary: "rbxassetid://15800356195", secondary: "rbxassetid://16301280992", colour: "#ba3838" },
	{ primary: "rbxassetid://15800387846", secondary: "rbxassetid://16301280449", colour: "#6b70a0" },
];

const ITEMS_PER_CASE = 10;
const MIN_PROFIT_CHANCE = 0.45;
const MAX_PROFIT_CHANCE = 0.51;

function selectCaseItems(
	validItems: { id: string; value: number }[],
	casePrice: number,
	usedItemIds: Set<string>,
): { id: string; value: number }[] {
	const items_with_higher_value = validItems.filter((item) => item.value >= casePrice && !usedItemIds.has(item.id));
	const items_with_lower_value = validItems.filter((item) => item.value < casePrice && !usedItemIds.has(item.id));
	const case_item_ids = new Set<string>();
	const items: { id: string; value: number }[] = [];

	while (
		items.length < Math.min(ITEMS_PER_CASE * 0.7, items_with_higher_value.length) &&
		items_with_higher_value.length > 0
	) {
		const randomIndex = Math.floor(Math.random() * items_with_higher_value.length);
		const item = items_with_higher_value.splice(randomIndex, 1)[0];

		if (item && !case_item_ids.has(item.id)) {
			items.push(item);
			case_item_ids.add(item.id);
		}
	}

	while (items.length < ITEMS_PER_CASE && items_with_lower_value.length > 0) {
		const randomIndex = Math.floor(Math.random() * items_with_lower_value.length);
		const item = items_with_lower_value.splice(randomIndex, 1)[0];

		if (item && !case_item_ids.has(item.id)) {
			items.push(item);
			case_item_ids.add(item.id);
		}
	}

	return items.sort(() => Math.random() - 0.5);
}

function calculateItemChances(
	items: { id: string; value: number }[],
	casePrice: number,
): { id: string; chance: number }[] {
	const offset = casePrice / 1.4;
	const adjusted_values = items.map((item) => 1 / Math.exp(item.value / offset));
	const total_adjusted_value = adjusted_values.reduce((acc, value) => acc + value, 0);
	let chances = adjusted_values.map((adjusted_value) => adjusted_value / total_adjusted_value);
	const target_profit_chance = Math.random() * (MAX_PROFIT_CHANCE - MIN_PROFIT_CHANCE) + MIN_PROFIT_CHANCE;

	let profit_chance = items
		.map((item, i) => ({
			value: item.value,
			chance: chances[i],
		}))
		.filter((item) => item.value >= casePrice)
		.reduce((total, item) => total + item.chance, 0);

	const scaling_factor = target_profit_chance / profit_chance;

	chances = chances.map((chance, i) => {
		const is_higher_value = items[i].value >= casePrice;
		return is_higher_value ? chance * scaling_factor : chance;
	});

	const total_chances = chances.reduce((acc, chance) => acc + chance, 0);
	chances = chances.map((chance) => (chance / total_chances) * 100);

	return items.map((item, i) => ({
		id: `${item.id}`,
		chance: Math.max(Number(chances[i].toFixed(5)), 0.00001),
		claimed: 0,
	}));
}

function selectUnusedUIData(usedUiDataIndices: number[]): { primary: string; secondary: string; colour: string } {
	let ui_data_index = Math.floor(Math.random() * UI_DATA.length);
	while (usedUiDataIndices.includes(ui_data_index)) {
		ui_data_index = Math.floor(Math.random() * UI_DATA.length);
	}
	usedUiDataIndices.push(ui_data_index);
	return UI_DATA[ui_data_index];
}

export default async function regenerate_cases(): Promise<[number, any]> {
	const connection = await getMariaConnection();
	if (!connection) {
		console.error("Database connection failed");
		return [500, { error: "Failed to establish database connection" }];
	}

	try {
		const cases = await smartQuery<ItemCase[]>(connection, "SELECT * FROM cases");

		const used_item_ids = new Set<string>();
		const used_ui_data_indices: number[] = [];

		for (let i = 0; i < cases.length; i++) {
			const case_data = cases[i];
			const valid_items = await smartQuery<{ id: string; value: number }[]>(
				connection,
				"SELECT id, value FROM items WHERE value > ? AND value < ?",
				[case_data.price / 2.5, case_data.price * 2.5],
			);

			const items = selectCaseItems(valid_items, case_data.price, used_item_ids);
			items.forEach((item) => used_item_ids.add(item.id));
			const case_items = calculateItemChances(items, case_data.price);
			const ui_data = selectUnusedUIData(used_ui_data_indices);

			await connection.query("UPDATE cases SET items = ?, ui_data = ?, next_rotation = ? WHERE id = ?", [
				JSON.stringify(case_items),
				JSON.stringify(ui_data),
				new Date(Date.now() + 1000 * 60 * 60 * 24 * 3),
				`tier_${i + 1}`,
			]);
		}

		return [200, { success: true }];
	} catch (error) {
		console.error("Error fetching cases:", error);
		return [
			500,
			{
				error: "Internal Server Error",
				details: error instanceof Error ? error.message : "Unknown error",
			},
		];
	} finally {
		connection.release();
	}
}
