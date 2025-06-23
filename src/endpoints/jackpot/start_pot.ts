import { FastifyRequest } from "fastify";
import { getRedisConnection } from "../../service/redis";
import { z } from "zod";
import { JackpotRedisManager } from "../../service/jackpot/jackpot-redis";

const startPotParamsSchema = z.object({
    id: z.string(),
});

export default {
    method: "POST",
    url: "/jackpot/start/:id",
    authType: "none",
    callback: async (request: FastifyRequest<{ Params: { id: string } }>) => {
        const paramsParse = startPotParamsSchema.safeParse(request.params);
        if (!paramsParse.success) {
            return [400, { error: "Invalid request", errors: paramsParse.error.flatten() }];
        }

        const { id } = paramsParse.data;
        const redis = await getRedisConnection();
        if (!redis) return [500, { error: "Failed to connect to the database" }];

        const jackpotManager = new JackpotRedisManager(redis, request.server);
        const success = await jackpotManager.startJackpot(id);
        if (!success) return [409, { error: "Failed to start jackpot" }];

        return [200, { status: "OK", message: "Started jackpot" }];
    }
}