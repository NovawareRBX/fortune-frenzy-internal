import { FastifyRequest } from "fastify";
import { packeter } from "../../utilities/packeter";

export default async function (
	request: FastifyRequest<{
		Params: { server_id: string };
		Body: { Packet: Array<any> };
	}>,
): Promise<[number, any]> {
	const response = await packeter(request.server, request.params.server_id, request.body.Packet);

	return [response[0], response[1]];
}
