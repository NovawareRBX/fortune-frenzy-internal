import * as crypto from "crypto";

export default function (extraEntropy: string[]): { result: number; hash: string } {
	const hash = crypto
		.createHash("sha256")
		.update(crypto.randomBytes(32))
		.update([process.env.SERVER_RANDOMNESS_SEED ?? "", ...extraEntropy].join(""))
		.digest("hex");

	const result = (hash[0].charCodeAt(0) % 2) + 1;
	return {
		result,
		hash,
	};
}
