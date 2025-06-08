import { FastifyInstance } from "fastify";
import { getRedisConnection } from "../service/redis";
import doSelfHttpRequest from "./internalRequest";

export async function packeter(server: FastifyInstance, server_id: string, packet: Array<any>): Promise<[number, any]> {
	const redis = await getRedisConnection();

	if (packet.length > 0) {
		const processingPromises = packet.map(async (element) => {
			try {
				const route = server.findRoute({
					url: element.route,
					method: element.method,
				});

				if (!route) {
					return redis.hSet(
						`packet:${server_id}`,
						element.request_id,
						JSON.stringify({
							request_id: element.request_id,
							response: [404, { error: "Not Found" }],
						}),
					);
				}

				const response = await doSelfHttpRequest(server, {
					method: element.method,
					url: element.route,
					query: element.query,
					body: element.body,
					headers: {
						...element.headers,
					},
				});

				return redis.hSet(
					`packet:${server_id}`,
					element.request_id,
					JSON.stringify({
						request_id: element.request_id,
						response: [response.statusCode, JSON.parse(response.body)],
					}),
				);
			} catch (error) {
				console.error(`Error processing request ${element.request_id}:`, error);
				return redis.hSet(
					`packet:${server_id}`,
					element.request_id,
					JSON.stringify({
						request_id: element.request_id,
						response: [500, { error: "Internal Server Error" }],
					}),
				);
			}
		});

		await Promise.all(processingPromises);
	}

	await Promise.all([
		redis.set(`servers:${server_id}:active`, "true", { EX: 1 }),
		redis.set(`servers:${server_id}:last_packet`, JSON.stringify(packet), { EX: 1 }),
	]);

	const responses = await redis.hGetAll(`packet:${server_id}`);
	const responses_object = Object.keys(responses).reduce((acc: { [key: string]: any }, key: string) => {
		acc[key] = JSON.parse(responses[key]);
		return acc;
	}, {});

	if (Object.keys(responses_object).length > 0) {
		await redis.del(`packet:${server_id}`);
	}

	return [
		200,
		{
			status: "OK",
			responses: responses_object,
		},
	];
}
