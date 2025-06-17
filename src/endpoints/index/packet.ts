import { FastifyRequest } from "fastify";
import { packeter } from "../../utilities/packeter";
import { z } from "zod";

const packetParamsSchema = z.object({
	server_id: z.string(),
});

const packetBodySchema = z.object({
	Packet: z.array(z.any()),
});

export default {
	method: "POST",
	url: "/packet/:server_id",
	authType: "key",
	callback: async function (
		request: FastifyRequest<{
			Params: { server_id: string };
			Body: { Packet: Array<any> };
		}>,
	): Promise<[number, any]> {
		const paramsParse = packetParamsSchema.safeParse(request.params);
		const bodyParse = packetBodySchema.safeParse(request.body);
		if (!paramsParse.success || !bodyParse.success) {
			return [400, { error: "Invalid request", errors: {
				params: !paramsParse.success ? paramsParse.error.flatten() : undefined,
				body: !bodyParse.success ? bodyParse.error.flatten() : undefined,
			}}];
		}

		const { server_id } = paramsParse.data;
		const { Packet } = bodyParse.data;
		const response = await packeter(request.server, server_id, Packet);
		return [response[0], response[1]];
	}
};
