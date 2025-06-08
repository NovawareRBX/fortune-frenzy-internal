import * as crypto from "crypto";
import { ItemRow } from "../endpoints/casebattles/get_cases";

export function randomCoinflip(
	extraEntropy: string[],
	chance1: number,
	chance2: number,
): { result: number; hash: string } {
	if (chance1 <= 0 || chance2 <= 0) {
		throw new Error("Chances must be positive numbers.");
	}

	const totalChances = chance1 + chance2;

	const hash = crypto
		.createHash("sha256")
		.update(crypto.randomBytes(32))
		.update([process.env.SERVER_RANDOMNESS_SEED ?? "", ...extraEntropy].join(""))
		.digest("hex");

	const randomValue = parseInt(hash.slice(0, 8), 16) % totalChances;

	const result = randomValue < chance1 ? 1 : 2;

	return {
		result,
		hash,
	};
}

export function randomCaseBattleSpin(
	items: ItemRow[],
	clientSeed: string,
	serverSeed: string,
	nonce: number,
) {
	const hash = crypto.createHash("sha256").update(`${clientSeed}:${serverSeed}:${nonce}`).digest("hex");
	const roll = parseInt(hash.slice(0, 8), 16) % 100000;
	return {
		result: items.find((item) => roll >= item.min_ticket && roll <= item.max_ticket)!,
		roll: roll.toString().padStart(5, "0"),
		hash,
	};
}

export function randomNumber(min: number, max: number, serverSeed: string) {
	return Number(
		(crypto.createHash("sha256").update(serverSeed).digest().readBigUInt64BE(0) * BigInt(max - min + 1)) /
			BigInt("0xffffffffffffffff") +
			BigInt(min),
	);
}
