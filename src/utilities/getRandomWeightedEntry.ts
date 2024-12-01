import { getRandomValues } from "crypto";

export type Entry = { id: string; chance: number; claimed: number };

export default function (entries: Entry[]): Entry {
	const totalChance = entries.reduce((sum, entry) => sum + entry.chance, 0);
	const randomValue = (getRandomValues(new Uint32Array(1))[0] / 0xffffffff) * totalChance;

	let cumulativeChance = 0;
	for (const entry of entries) {
		cumulativeChance += entry.chance;
		if (randomValue <= cumulativeChance) {
			return entry;
		}
	}

	return entries[entries.length - 1];
}
