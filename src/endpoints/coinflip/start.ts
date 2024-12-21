import { FastifyRequest } from "fastify";
import { getMariaConnection } from "../../service/mariadb";
import query from "../../utilities/smartQuery";
import secureFlip from "../../utilities/secureFlip";

export default async function (
	request: FastifyRequest<{
		Params: { coinflip_id: string };
	}>,
): Promise<[number, any]> {
	if (!request.params.coinflip_id || typeof request.params.coinflip_id !== "string")
		return [400, { error: "Invalid request" }];

	const id = request.params.coinflip_id;
	const connection = await getMariaConnection();

	if (!connection) return [500, { error: "Failed to connect to the database" }];

	try {
		await connection.beginTransaction();
		const [coinflip] = await query(connection, "SELECT * FROM coinflips WHERE id = ? FOR UPDATE", [
			id,
		]);
		if (!coinflip) {
			await connection.rollback();
			return [404, { error: "Coinflip not found" }];
		}

		if (coinflip.status !== "awaiting_confirmation") {
			await connection.rollback();
			return [400, { error: "Coinflip cannot be started" }];
		}

		const result = secureFlip(coinflip.player1, coinflip.player2).outcome;
		await query(
			connection,
			"UPDATE coinflips SET status = 'completed', winning_coin = ?, status = 'completed' WHERE id = ?",
			[result, id],
		);

		const response = await request.server.inject({
			method: "POST",
			url: "/items/item-transfer",
			body: [
				{ user_id: coinflip.player1, items: coinflip.player1_items.split(",") },
				{ user_id: coinflip.player2, items: coinflip.player2_items.split(",") },
			],
		});

		if (response.statusCode !== 200) {
			await query(connection, "UPDATE coinflips SET status = 'failed' WHERE id = ?", [id]);
			await connection.commit();
			return [500, { error: "Internal Server Error" }];
		}

		const body = JSON.parse(response.body);
		const transfer_id = body.transfer_id;
		await query(connection, "UPDATE coinflips SET transfer_id = ? WHERE id = ?", [
			transfer_id,
			id,
		]);
		await connection.commit();

		return [
			200,
			{
				status: "OK",
				data: {
					...coinflip,
					status: "completed",
					winning_coin: result,
					transfer_id,
				},
			},
		];
	} catch (error) {
		console.error(error);
		await connection.rollback();
		return [500, { error: "Internal Server Error" }];
	} finally {
		connection.release();
	}
}
