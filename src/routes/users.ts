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
        url: '/users/:id',
        authType: "none",
        requiredHeaders: ["target-user-id"], // only used for authentication
        callback: async (request: FastifyRequest<{ Params: Params }>, reply: FastifyReply) => {
            const connection = await getMariaConnection();
            try {
                const user_id = request.params.id;

                const rows = await connection.query(
                    'INSERT INTO users (user_id) VALUES (?) ON DUPLICATE KEY UPDATE user_id = user_id RETURNING *',
                    [user_id]
                );

                const result = rows[0];
                Object.keys(result).forEach(key => typeof result[key] === 'bigint' && (result[key] = result[key].toString()));


                return [200, {
                    status: "OK",
                    data: result
                }];
            } catch (error) {
                console.error('Error fetching user:', error);
                return [500, { error: 'Internal Server Error' }];
            } finally {
                await connection.release();
            }
        },
    }

];

async function userRoutes(fastify: FastifyInstance) {
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

export default userRoutes;