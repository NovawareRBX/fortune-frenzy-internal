import { FastifyRequest } from "fastify";
import { getPostgresConnection } from "../../service/postgres";
import { generateFreshUaid } from "../../utilities/generateFreshUaid";
import { z } from "zod";
import { randomInt } from "crypto";

const spawnItemsBodySchema = z.object({
    user_id: z.string().regex(/^\d+$/),
    count: z.number().int().positive().max(100000).default(10000),
});

export default {
    method: "POST",
    url: "/items/spawn",
    authType: "key",
    callback: async function (
        request: FastifyRequest<{ Body: { user_id: string; count?: number } }>,
    ): Promise<[number, any]> {
        const bodyParse = spawnItemsBodySchema.safeParse(request.body);
        if (!bodyParse.success) {
            return [400, { error: "Invalid request", details: bodyParse.error.flatten() }];
        }

        const { user_id, count } = { ...bodyParse.data, count: bodyParse.data.count ?? 10000 };

        const connection = await getPostgresConnection();
        if (!connection) {
            return [500, { error: "Failed to connect to the database" }];
        }

        try {
            const { rowCount: userExists } = await connection.query("SELECT 1 FROM users WHERE user_id = $1", [user_id]);
            if (userExists === 0) {
                return [404, { error: "User not found" }];
            }

            const { rows: items } = await connection.query<{ id: string }>("SELECT id FROM items");
            if (items.length === 0) {
                return [500, { error: "No items found in database" }];
            }

            const values: string[] = [];
            const params: any[] = [];
            const unboxedCounts: Map<string, number> = new Map();
            let paramIndex = 1;

            await connection.query("BEGIN");

            for (let i = 0; i < count; i++) {
                const randomItem = items[randomInt(items.length)];
                const uaid = await generateFreshUaid(connection);

                values.push(`($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2})`);
                params.push(randomItem.id, user_id, uaid);
                paramIndex += 3;

                unboxedCounts.set(randomItem.id, (unboxedCounts.get(randomItem.id) || 0) + 1);
            }

            await connection.query(
                `INSERT INTO item_copies (item_id, owner_id, user_asset_id) VALUES ${values.join(", ")}`,
                params,
            );

            for (const [itemId, cnt] of unboxedCounts) {
                await connection.query(
                    "UPDATE items SET total_unboxed = total_unboxed + $1 WHERE id = $2",
                    [cnt, itemId],
                );
            }

            await connection.query("COMMIT");

            return [200, { status: "OK", spawned: count }];
        } catch (error) {
            await connection.query("ROLLBACK");
            console.error("Error spawning items:", error);
            return [500, { error: "Internal Server Error" }];
        } finally {
            connection.release();
        }
    },
}; 