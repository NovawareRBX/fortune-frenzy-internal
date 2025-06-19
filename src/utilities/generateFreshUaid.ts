import { PoolClient } from "pg";

function generateFFID(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(6));
	let num = BigInt(0);
	for (const byte of bytes) {
		num = (num << BigInt(8)) | BigInt(byte);
	}
	return "FF" + num.toString().padStart(12, "0");
}

export async function generateFreshUaid(connection: PoolClient, retries = 10): Promise<string> {
	for (let i = 0; i < retries; i++) {
		const id = generateFFID();
		const { rowCount } = await connection.query("SELECT 1 FROM item_copies WHERE user_asset_id = $1", [id]);
		if (rowCount === 0) return id;
	}
	throw new Error(`generateFreshUaid: exhausted ${retries} attempts`);
}
