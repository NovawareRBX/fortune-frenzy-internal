import { FastifyRequest } from "fastify";
import { packeter } from "../../utilities/packeter";
import { getMariaConnection } from "../../service/mariadb";
import smartQuery from "../../utilities/smartQuery";

export default {
	method: "GET",
	url: "/discord/transcript/:transcript_id",
	authType: "none",
	callback: async function (
		request: FastifyRequest<{
			Params: { transcript_id: string };
		}>,
	): Promise<[number, any]> {
		const maria = await getMariaConnection("NovawareDiscord");
		const transcript = await smartQuery(maria, "SELECT * FROM ticket_transcripts WHERE transcript_id = ?", [
			request.params.transcript_id,
		]);

		if (transcript.length === 0) {
			await maria.release();
			return [404, { error: "Transcript not found" }];
		}

		maria.release()
		return [200, transcript[0]];
	}
};
