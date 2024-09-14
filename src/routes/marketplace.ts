import { FastifyInstance, RouteOptions, FastifyRequest, FastifyReply } from 'fastify';
import { Endpoint } from '../types/Endpoints';
import { getMariaConnection } from '../service/mariadb';
import { authorization } from '../middleware/authorization';
import { getRedisConnection } from '../service/redis';
import { createHash, randomBytes } from 'crypto';

interface Params {
    id: string;
}

const endpoints: Endpoint<Params, Body>[] = [
    {
        method: 'GET',
        url: '/marketplace/items/:id',
        authType: "none",
        callback: async (request: FastifyRequest<{ Params: Params }>, reply: FastifyReply) => {
            try {
                const connection = await getMariaConnection();
                const item_id = request.params.id;

                const rows = await connection.query(
                    'SELECT * FROM items WHERE id = ?',
                    [item_id]
                )

                await connection.release();
                if (rows.length === 0) {
                    return [404, { error: 'Item not found' }];
                }

                const result = rows[0];
                Object.keys(result).forEach(key => typeof result[key] === 'bigint' && (result[key] = result[key].toString()));

                return [200, {
                    status: "OK",
                    data: result
                }];

            } catch (error) {
                console.error('Error fetching item:', error);
                return [500, { error: 'Internal Server Error' }];
            }
        },
    },
    {
        method: "GET",
        url: "/marketplace/items",
        authType: "none",
        callback: async (request: FastifyRequest, reply: FastifyReply) => {
            try {
                const connection = await getMariaConnection();

                const rows = await connection.query(
                    'SELECT * FROM items'
                );

                await connection.release();
                const result = rows.map((row: any) => {
                    Object.keys(row).forEach(key => typeof row[key] === 'bigint' && (row[key] = row[key].toString()));
                    return row;
                });

                return [200, {
                    status: "OK",
                    data: result
                }];
            } catch (error) {
                console.error('Error fetching items:', error);
                return [500, { error: 'Internal Server Error' }];
            }
        }
    }
];

async function marketplaceRoutes(fastify: FastifyInstance) {
    endpoints.forEach((endpoint) => {
        const routeOptions: RouteOptions = {
            method: endpoint.method,
            url: endpoint.url,
            handler: async (request: FastifyRequest, reply: FastifyReply) => {
                const [statusCode, response] = await endpoint.callback(request as FastifyRequest<{ Params: Params; Body: Body }>, reply);
                reply.code(statusCode).send(response);
            }
        };

        if (endpoint.authType !== "none") {
            routeOptions.preHandler = async (request: FastifyRequest, reply: FastifyReply, done: any) => {
                await authorization(request, endpoint.authType, endpoint.requiredHeaders);

                if (endpoint.authType === "server_key" && !request.headers["packeter-master-key"]) {
                    const server_id = request.headers["server-id"] as string;
                    const redis = await getRedisConnection();
                    const new_api_key = randomBytes(32).toString('hex');
                    await redis.set(`api_key:${server_id}`, createHash("sha256").update(new_api_key).digest("hex"), { EX: 60 * 5 });
                    reply.header("new-api-key", new_api_key);
                }

                return
            };
        }

        fastify.route(routeOptions);
    });
}

export default marketplaceRoutes;