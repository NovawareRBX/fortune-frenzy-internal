import { FastifyRequest } from "fastify";
import { z } from "zod";

const findItemsInRangeSchema = z.object({
	user_id: z.string(),
	minValue: z.coerce.number().int().nonnegative(),
	maxValue: z.coerce.number().int().nonnegative(),
	maxItems: z.coerce.number().int().positive(),
	minItems: z.coerce.number().int().nonnegative(),
});

export default {
	method: "GET",
	url: "/items/find_items_in_range",
	authType: "none",
	callback: async (
		request: FastifyRequest<{
			Querystring: z.infer<typeof findItemsInRangeSchema>;
		}>,
	) => {
		const queryParse = findItemsInRangeSchema.safeParse(request.query);
		if (!queryParse.success) {
			return [
				400,
				{
					error: "Invalid request",
					errors: {
						query: queryParse.error.flatten(),
					},
				},
			];
		}

		try {
			const qs = new URLSearchParams(request.query as any).toString();
			const response = await fetch(`http://localhost:4000/items/find_items_in_range?${qs}`);

			if (!response.ok) {
				const text = await response.text();
				return [response.status, { error: text }];
			}

			const data = await response.json();
			return [200, data];
		} catch (err) {
			return [500, { error: "Failed to reach Rust service", details: (err as Error).message }];
		}
	},
};
