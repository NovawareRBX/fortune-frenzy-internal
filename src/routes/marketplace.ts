import { FastifyInstance, RouteOptions, FastifyRequest, FastifyReply } from "fastify";
import { Endpoint } from "../types/Endpoints";
import { getMariaConnection } from "../service/mariadb";
import { authorization } from "../middleware/authorization";
import { getRedisConnection } from "../service/redis";
import { createHash, randomBytes } from "crypto";
import { registerRoutes } from "../utilities/routeHandler";

const endpoints: Endpoint[] = [
	{
		method: "GET",
		url: "/marketplace/items/:id",
		authType: "none",
		callback: async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
			const connection = await getMariaConnection();
			try {
				const item_id = request.params.id;

				const rows = await connection.query("SELECT * FROM items WHERE id = ?", [item_id]);

				if (rows.length === 0) {
					return [404, { error: "Item not found" }];
				}

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
				console.error("Error fetching item:", error);
				return [500, { error: "Internal Server Error" }];
			} finally {
				await connection.release();
			}
		},
	},
	{
		method: "GET",
		url: "/marketplace/items",
		authType: "none",
		callback: async (request: FastifyRequest, reply: FastifyReply) => {
			const connection = await getMariaConnection();
			try {
				const rows = await connection.query("SELECT * FROM items");
				const result = rows.map((row: any) => {
					Object.keys(row).forEach((key) => typeof row[key] === "bigint" && (row[key] = row[key].toString()));
					return row;
				});

				return [200, { status: "OK", data: result }];
			} catch (error) {
				console.error("Error fetching items:", error);
				return [500, { error: "Internal Server Error" }];
			} finally {
				await connection.release();
			}
		},
	},
];

async function marketplaceRoutes(fastify: FastifyInstance) {
	await registerRoutes(fastify, endpoints);
}

export default marketplaceRoutes;
