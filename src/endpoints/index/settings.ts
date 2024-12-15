import { FastifyRequest } from "fastify";
import { getMariaConnection } from "../../service/mariadb";
import { createHash, randomBytes } from "crypto";

export default async function (request: FastifyRequest<{ Params: { game_id: string } }>): Promise<[number, any]> {
	const game_id = request.params.game_id;
	const maria = await getMariaConnection();

	const [settings] = await maria.query("SELECT * FROM settings WHERE id = ?", [game_id]);

    if (settings.length === 0) {
        return [404, { error: "Settings not found" }];
    }

    return [200, {
        status: "OK",
        result: settings,
    }];
}
