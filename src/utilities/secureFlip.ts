import { createHash, randomBytes } from "crypto";

export default function (userId1: string, userId2: string) {
    const server_seed = process.env.SERVER_RANDOMNESS_SEED!;
    const server_seed_hash = createHash("sha256").update(server_seed).digest("hex");
    const nonce = randomBytes(16).toString("hex");
    const combined = `${userId1}${userId2}:${server_seed}:${nonce}`;
    const hash_result = createHash("sha256").update(combined).digest("hex");
    const outcome = (parseInt(hash_result, 16) % 2) + 1;

    return {
        server_seed_hash,
        nonce,
        hash_result,
        outcome,
    };
}