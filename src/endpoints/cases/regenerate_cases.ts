import { getMariaConnection } from "../../service/mariadb";
import { ItemCase } from "../../types/Endpoints";
import smartQuery from "../../utilities/smartQuery";
import { randomInt } from "crypto";

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
function selectCaseItems(
	validItems: { id: string; value: number }[],
	casePrice: number,
	usedItemIds: Set<string>,
): { id: string; value: number }[] {
	const items_with_higher_value = validItems.filter(
		(item) => item.value >= casePrice && !usedItemIds.has(item.id) && item.value >= casePrice * 0.5,
	);
	const items_with_lower_value = validItems.filter(
		(item) => item.value < casePrice && !usedItemIds.has(item.id) && item.value >= casePrice * 0.5,
	);
	const backup_items = validItems.filter((item) => item.value < casePrice * 0.5 && !usedItemIds.has(item.id));

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

	while (items.length < ITEMS_PER_CASE && backup_items.length > 0) {
		const randomIndex = Math.floor(Math.random() * backup_items.length);
		const item = backup_items.splice(randomIndex, 1)[0];

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
	targetProfitPct = 50
  ) {
	const sumValues = items.reduce((acc, it) => acc + it.value, 0);
	const EPSILON = 1e-9;
	let rawWeights = items.map((it) => sumValues / (it.value + EPSILON));
	let sumRaw = rawWeights.reduce((acc, w) => acc + w, 0);
	let chances = rawWeights.map((w) => (w / sumRaw) * 100);
  
	const isProfit = (value: number) => value >= casePrice;
	let profitChance = items.reduce((acc, it, i) => {
	  return isProfit(it.value) ? acc + chances[i] : acc;
	}, 0);
  
	if (Math.abs(profitChance - targetProfitPct) < 0.01) {
	  // good enough
	} else {
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
	  claimed: 0
	}));
  }
  

function selectUnusedUIData(usedUiDataIndices: number[]): { primary: string; secondary: string; colour: string } {
	let ui_data_index = randomInt(UI_DATA.length);
	while (usedUiDataIndices.includes(ui_data_index)) {
		ui_data_index = randomInt(UI_DATA.length);
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
				[case_data.price / 4, case_data.price * 2.5],
			);

			console.log(`${valid_items.length} valid items found for case ${case_data.id}`);

			const items = selectCaseItems(valid_items, case_data.price, used_item_ids);
			items.forEach((item) => used_item_ids.add(item.id));
			const case_items = calculateItemChances(items, case_data.price);
			const ui_data = selectUnusedUIData(used_ui_data_indices);

			await connection.query(
				"UPDATE cases SET items = ?, ui_data = ?, next_rotation = ?, opened_count = 0 WHERE id = ?",
				[
					JSON.stringify(case_items),
					JSON.stringify(ui_data),
					new Date(Date.now() + 1000 * 60 * 60 * 24 * 3),
					`tier_${i + 1}`,
				],
			);
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
