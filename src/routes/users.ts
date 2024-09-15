import { FastifyInstance, RouteOptions, FastifyRequest, FastifyReply, FastifySchema } from "fastify";
import { Endpoint } from "../types/Endpoints";
import { getMariaConnection } from "../service/mariadb";
import { authorization } from "../middleware/authorization";
import { getRedisConnection } from "../service/redis";
import { createHash, randomBytes } from "crypto";
import { registerRoutes } from "../utilities/routeHandler";

const endpoints: Endpoint[] = [
	{
		method: "GET",
		url: "/users/:id",
		authType: "none",
		callback: async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
			const connection = await getMariaConnection();
			try {
				const user_id = request.params.id;

				const rows = await connection.query(
					"INSERT INTO users (user_id) VALUES (?) ON DUPLICATE KEY UPDATE user_id = user_id RETURNING *",
					[user_id],
				);

				const result = rows[0];
				Object.keys(result).forEach(
					(key) => typeof result[key] === "bigint" && (result[key] = result[key].toString()),
				);

				return [
					200,
					{
						status: "OK",
						data: result,
					},
				];
			} catch (error) {
				console.error("Error fetching user:", error);
				return [500, { error: "Internal Server Error" }];
			} finally {
				await connection.release();
			}
		},
	},
];

async function userRoutes(fastify: FastifyInstance) {
	await registerRoutes(fastify, endpoints);
}

export default userRoutes;
