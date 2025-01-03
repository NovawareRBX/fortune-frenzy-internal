import * as crypto from "crypto";

export default function (extraEntropy: string[], chance1: number, chance2: number): { result: number; hash: string } {
	if (chance1 <= 0 || chance2 <= 0) {
		throw new Error("Chances must be positive numbers.");
	}

	const totalChances = chance1 + chance2;

	const hash = crypto
		.createHash("sha256")
		.update(crypto.randomBytes(32))
		.update([process.env.SERVER_RANDOMNESS_SEED ?? "", ...extraEntropy].join(""))
		.digest("hex");

	const randomValue = parseInt(hash.slice(0, 8), 16) % totalChances; // Generate a random number in the range [0, totalChances)

	const result = randomValue < chance1 ? 1 : 2;

	return {
		result,
		hash,
	};
}
