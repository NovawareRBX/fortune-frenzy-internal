import { FastifyRequest } from "fastify";
import secureFlip from "../../utilities/secureFlip";
import { getRedisConnection } from "../../service/redis";

export default async function (
	request: FastifyRequest<{
		Params: { coinflip_id: string };
	}>,
): Promise<[number, any]> {
	if (!request.params.coinflip_id || typeof request.params.coinflip_id !== "string") {
		return [400, { error: "Invalid request" }];
	}

	const id = request.params.coinflip_id;
	const redis = await getRedisConnection();

	try {
		const coinflipRaw = await redis.get(`coinflip:${id}`);
		if (!coinflipRaw) {
			return [404, { error: "Coinflip not found" }];
		}

		const coinflip = JSON.parse(coinflipRaw);
		if (coinflip.status !== "awaiting_confirmation") {
			return [400, { error: "Coinflip cannot be started" }];
		}

		coinflip.status = "completed";
		coinflip.results = secureFlip([coinflip.player1, coinflip.player2]);

		await redis.set(`coinflip:${id}`, JSON.stringify(coinflip), { EX: 3600 }); // Refresh TTL

		const response = await request.server.inject({
			method: "POST",
			url: "/items/item-transfer",
			body: [
				{
					user_id: coinflip.player1.id,
					items: coinflip.player1_items.map((item: string) => item.split(":")[0]),
				},
				{
					user_id: coinflip.player2.id,
					items: coinflip.player2_items.map((item: string) => item.split(":")[0]),
				},
			],
		});

		if (response.statusCode !== 200) {
			console.error("Failed to transfer items:", response.body);
			coinflip.status = "failed";
			await redis.set(`coinflip:${id}`, JSON.stringify(coinflip), { EX: 3600 });
			return [500, { error: "Internal Server Error" }];
		}

		const body = JSON.parse(response.body);
		coinflip.transfer_id = body.transfer_id;
		await redis.set(`coinflip:${id}`, JSON.stringify(coinflip), { EX: 3600 });

		return [
			200,
			{
				status: "OK",
				data: coinflip,
			},
		];
	} catch (error) {
		console.error("Failed to process coinflip:", error);
		return [500, { error: "Internal Server Error" }];
	}
}
