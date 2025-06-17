import { FastifyRequest } from "fastify";
import { z } from "zod";

const searchUsersQuerySchema = z.object({
	keywords: z.string().optional(),
	limit: z.string().regex(/^\d+$/).optional(),
});

export default {
	method: "GET",
	url: "/search/users",
	authType: "none",
	callback: async function (
		request: FastifyRequest<{ Querystring: { keywords?: string; limit?: string } }>,
	): Promise<[number, any]> {
		// Validate querystring using Zod
		const queryParse = searchUsersQuerySchema.safeParse(request.query);
		if (!queryParse.success) {
			return [400, { error: "Invalid query", errors: queryParse.error.flatten() }];
		}

		const query = (queryParse.data.keywords || "").trim().toLowerCase();
		const limit = queryParse.data.limit ? parseInt(queryParse.data.limit, 10) : 40;
		if (limit < 1 || limit > 40) return [400, { error: "Limit must be between 1 and 40" }];

		try {
			const response = await fetch(`${process.env.MEILISEARCH_HOST}/indexes/users/search`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${process.env.MEILISEARCH_SEARCH_KEY}`,
				},
				body: JSON.stringify({
					q: query,
					sort: ["current_cash:desc"],
					limit,
				}),
			});

			if (!response.ok) {
				const errorText = await response.text();
				console.error("Meilisearch search failed:", errorText);
				return [500, { error: "Meilisearch search failed" }];
			}

			const data = await response.json();

			return [
				200,
				{
					status: "OK",
					results: data.hits,
				},
			];
		} catch (error) {
			console.error(error);
			return [500, { error: "Failed to search users" }];
		}
	},
};
