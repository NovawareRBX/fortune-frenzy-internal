import { FastifyRequest } from "fastify";
import { getPostgresConnection } from "../../service/postgres";
import { z } from "zod";

const settingsParamsSchema = z.object({
    game_id: z.string(),
});

export default {
    method: "GET",
    url: "/settings/:game_id",
    authType: "none",
    callback: async function(request: FastifyRequest<{ Params: { game_id: string } }>): Promise<[number, any]> {
        const paramsParse = settingsParamsSchema.safeParse(request.params);
        if (!paramsParse.success) {
            return [400, { error: "Invalid request", errors: paramsParse.error.flatten() }];
        }
        const { game_id } = paramsParse.data;
        const pgClient = await getPostgresConnection();

        try {
            const { rows: settings } = await pgClient.query("SELECT * FROM settings WHERE id = $1", [game_id]);

            if (settings.length === 0) {
                return [404, { error: "Settings not found" }];
            }

            return [200, {
                status: "OK",
                result: settings,
            }];
        } finally {
            await pgClient.release();
        }
    }
};
