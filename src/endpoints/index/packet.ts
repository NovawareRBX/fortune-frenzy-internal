import { FastifyRequest } from "fastify";
import { packeter } from "../../utilities/packeter";

export default async function (
	request: FastifyRequest<{ Params: { server_id: string }; Body: { Packet: string } }>,
): Promise<[number, any]> {
	return await packeter(
		request.server,
		request.params.server_id,
		JSON.parse(Buffer.from(request.body.Packet, "base64").toString("utf-8")),
	);
}
