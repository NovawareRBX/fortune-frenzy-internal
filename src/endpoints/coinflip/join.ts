import { FastifyRequest } from "fastify";
import { getRedisConnection } from "../../service/redis";
import { getMariaConnection } from "../../service/mariadb";
import getItemString from "../../utilities/getItemString";
import getUserInfo from "../../utilities/getUserInfo";
import doSelfHttpRequest from "../../utilities/internalRequest";
import { CoinflipRedisManager } from "../../service/coinflip-redis";
import { z } from "zod";

const joinParamsSchema = z.object({
	coinflip_id: z.string(),
});

const joinBodySchema = z.object({
	user_id: z.number(),
	items: z.array(z.string().regex(/^FF/)).min(1),
});

export default {
	method: "POST",
	url: "/coinflip/join/:coinflip_id",
	authType: "key",
	callback: async function(
		request: FastifyRequest<{
			Params: { coinflip_id: string };
			Body: { user_id: number; items: string[] };
		}>,
	): Promise<[number, any]> {
		const paramsParse = joinParamsSchema.safeParse(request.params);
		const bodyParse = joinBodySchema.safeParse(request.body);
		if (!paramsParse.success || !bodyParse.success) {
			return [400, { error: "Invalid request", errors: {
				params: !paramsParse.success ? paramsParse.error.flatten() : undefined,
				body: !bodyParse.success ? bodyParse.error.flatten() : undefined,
			}}];
		}
		const { coinflip_id } = paramsParse.data;
		const { user_id, items } = bodyParse.data;

		const redis = await getRedisConnection();
		const connection = await getMariaConnection();

		if (!connection || !redis) {
			return [500, { error: "Failed to connect to the database" }];
		}

		const coinflipManager = new CoinflipRedisManager(redis, request.server);

		try {
			const confirmed_items = await connection.query(
				"SELECT user_asset_id FROM item_copies WHERE user_asset_id IN (?) AND owner_id = ?",
				[items, user_id],
			);

			if (confirmed_items.length !== items.length) {
				return [400, { error: "Invalid items" }];
			}

			const coinflip = await coinflipManager.getCoinflip(coinflip_id);
			if (!coinflip) {
				return [400, { error: "Invalid or unavailable coinflip" }];
			}

			if (coinflip.status !== "waiting_for_player") {
				return [400, { error: "Coinflip cannot be joined" }];
			}

			if (coinflip.player1.id === user_id.toString()) {
				return [400, { error: "Cannot join your own coinflip" }];
			}

			const [player2_item_ids_string] = await Promise.all([getItemString(connection, items)]);
			const [player2_info] = await getUserInfo(connection, [user_id.toString()]);

			const updatedCoinflip = {
				...coinflip,
				player2: {
					id: user_id.toString(),
					username: player2_info.username,
					display_name: player2_info.display_name
				},
				player2_items: player2_item_ids_string,
				status: "awaiting_confirmation" as "waiting_for_player" | "awaiting_confirmation" | "completed" | "failed"
			};

			const success = await coinflipManager.joinCoinflip(coinflip_id, user_id, updatedCoinflip);
			if (!success) {
				return [400, { error: "Failed to join coinflip" }];
			}

			setTimeout(async () => {
				console.log("Starting coinflip", coinflip_id);

				const response = await doSelfHttpRequest(request.server, {
					method: "POST",
					url: `/coinflip/start/${coinflip_id}`,
					body: {
						coinflip_id,
					},
				});

				console.log("Coinflip started", coinflip_id, response.body);

				if (response.statusCode !== 200) {
					updatedCoinflip.status = "failed";
					await coinflipManager.completeCoinflip(coinflip_id, updatedCoinflip);
				}
			}, 1000 * 1.5);

			return [
				200,
				{
					status: "OK",
					data: updatedCoinflip,
				},
			];
		} catch (error) {
			return [500, { error: "Failed to join coinflip" }];
		} finally {
			connection.release();
		}
	}
};
