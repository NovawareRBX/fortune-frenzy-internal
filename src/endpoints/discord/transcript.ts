import { FastifyRequest } from "fastify";
import { packeter } from "../../utilities/packeter";
import { z } from "zod";

const transcriptParamsSchema = z.object({
	transcript_id: z.string(),
});

export default {
	method: "GET",
	url: "/discord/transcript/:transcript_id",
	authType: "none",
	callback: async function (
		request: FastifyRequest<{
			Params: { transcript_id: string };
		}>,
	): Promise<[number, any]> {
		return [404, { error: "Not implemented" }];

		// const paramsParse = transcriptParamsSchema.safeParse(request.params);
		// if (!paramsParse.success) {
		// 	return [400, { error: "Invalid request", errors: paramsParse.error.flatten() }];
		// }
		// const { transcript_id } = paramsParse.data;

		// const maria = await getMariaConnection("NovawareDiscord");
		// const transcript = await smartQuery(maria, "SELECT * FROM ticket_transcripts WHERE transcript_id = ?", [
		// 	transcript_id,
		// ]);

		// if (transcript.length === 0) {
		// 	await maria.release();
		// 	return [404, { error: "Transcript not found" }];
		// }

		// maria.release()
		// return [200, transcript[0]];
	}
};
