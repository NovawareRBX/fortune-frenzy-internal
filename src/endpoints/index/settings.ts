import { FastifyRequest } from "fastify";
import { getMariaConnection } from "../../service/mariadb";
import { createHash, randomBytes } from "crypto";
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
        const maria = await getMariaConnection();

        try {
            const [settings] = await maria.query("SELECT * FROM settings WHERE id = ?", [game_id]);

            if (settings.length === 0) {
                return [404, { error: "Settings not found" }];
            }

            return [200, {
                status: "OK",
                result: settings,
            }];
        } finally {
            await maria.release();
        }
    }
};
