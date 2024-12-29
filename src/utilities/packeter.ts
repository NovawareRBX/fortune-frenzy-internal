import { FastifyInstance } from "fastify";
import { getRedisConnection } from "../service/redis";

export async function packeter(server: FastifyInstance, server_id: string, packet: Array<any>): Promise<[number, any]> {
	const redis = await getRedisConnection();
	packet.forEach((element) => {
		(async () => {
			const route_str = element.route;
			const route = server.findRoute({
				url: route_str,
				method: element.method,
			});

			if (!route) {
				await redis.hSet(
					`packet:${server_id}`,
					element.request_id,
					JSON.stringify({
						request_id: element.request_id,
						response: [404, { error: "Not Found" }],
					}),
				);
				return;
			}

			try {
				const response = await server.inject({
					method: element.method,
					url: route_str,
					query: element.query,
					body: element.body,
					headers: {
						...element.headers,
						"packeter-master-key": process.env.PACKETER_BYPASS_KEY,
					},
				});

				const request_id = element.request_id;
				const response_packet = {
					request_id: request_id,
					response: [response.statusCode, JSON.parse(response.body)],
				};

				await redis.hSet(`packet:${server_id}`, request_id, JSON.stringify(response_packet));
			} catch (error) {
				console.error(`Error processing request ${element.request_id}:`, error);
				await redis.hSet(
					`packet:${server_id}`,
					element.request_id,
					JSON.stringify({
						request_id: element.request_id,
						response: [500, { error: "Internal Server Error" }],
					}),
				);
			}
		})();
	});

	await Promise.all([
		redis.set(`servers:${server_id}:active`, "true", { EX: 1 }),
		redis.set(`servers:${server_id}:last_packet`, JSON.stringify(packet), { EX: 1 }),
	]);

	await new Promise((resolve) => setTimeout(resolve, 10));
	const responses = await redis.hGetAll(`packet:${server_id}`);

	const responses_object = Object.keys(responses).reduce((acc: { [key: string]: any }, key: string) => {
		acc[key] = JSON.parse(responses[key]);
		return acc;
	}, {});

	await redis.del(`packet:${server_id}`);

	return [
		200,
		{
			status: "OK",
			responses: responses_object,
		},
	];
}
