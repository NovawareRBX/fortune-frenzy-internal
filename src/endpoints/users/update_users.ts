import { FastifyRequest } from "fastify";
import { z } from "zod";
import { getMariaConnection } from "../../service/mariadb";

// Zod schemas for validating the request body
const recentActivitySchema = z.object({
	text: z.string(),
	icon: z.string(),
});

const userSchema = z.object({
	user_id: z.string().regex(/^\d+$/),
	name: z.string(),
	display_name: z.string(),
	total_cash_earned: z.number(),
	total_cash_spent: z.number(),
	current_cash: z.number(),
	current_value: z.number(),
	win_rate: z.number(),
	biggest_win: z.number(),
	total_plays: z.number(),
	favourite_mode: z.string(),
	time_played: z.number(),
	xp: z.number(),
	recent_activity: z.array(recentActivitySchema),
});

const updateUsersBodySchema = z.array(userSchema).nonempty();

export default {
	method: "POST",
	url: "/users/update",
	authType: "key",
	callback: async function (
		request: FastifyRequest<{
			Body: {
				user_id: string;
				name: string;
				display_name: string;
				total_cash_earned: number;
				total_cash_spent: number;
				current_cash: number;
				current_value: number;
				win_rate: number;
				biggest_win: number;
				total_plays: number;
				favourite_mode: string;
				time_played: number;
				xp: number;
				recent_activity: {
					text: string;
					icon: string;
				}[];
			}[];
		}>,
	): Promise<[number, any]> {
		// Validate body using Zod
		const bodyParse = updateUsersBodySchema.safeParse(request.body);
		if (!bodyParse.success) {
			return [400, { error: "Invalid request body", errors: bodyParse.error.flatten() }];
		}

		const connection = await getMariaConnection();
		if (!connection) {
			return [500, { error: "Failed to connect to the database" }];
		}

		try {
			const users = bodyParse.data;
			const placeholders = users.map(() => "(?, ?, ?, ?, ?, ?)").join(", ");
			const values: any[] = [];
			const recent_activity_values: any[] = [];
			const meiliUsers: any[] = [];

			users.forEach((u) => {
				const stats = {
					total_cash_earned: u.total_cash_earned,
					total_cash_spent: u.total_cash_spent,
					win_rate: u.win_rate,
					biggest_win: u.biggest_win,
					total_plays: u.total_plays,
					favourite_mode: u.favourite_mode,
					time_played: u.time_played,
					xp: u.xp,
				};

				values.push(u.user_id, u.name, u.display_name, JSON.stringify(stats), u.current_cash, u.current_value);

				u.recent_activity.forEach((activity) => {
					recent_activity_values.push(u.user_id, activity.icon, activity.text);
				});

				// Prepare user data for Meilisearch indexing
				meiliUsers.push({
					id: u.user_id,
					name: u.name,
					display_name: u.display_name,
					current_cash: u.current_cash,
					current_value: u.current_value,
				});
			});

			// Insert/update users in MariaDB
			await connection.query(
				`INSERT INTO users (user_id, name, display_name, statistics, current_cash, current_value)
				 VALUES ${placeholders}
				 ON DUPLICATE KEY UPDATE
					 name = VALUES(name),
					 display_name = VALUES(display_name),
					 statistics = VALUES(statistics),
					 current_cash = VALUES(current_cash),
					 current_value = VALUES(current_value)
					 `,
				values,
			);

			// Insert recent activity
			if (recent_activity_values.length > 0) {
				const raPlaceholders = Array(Math.floor(recent_activity_values.length / 3))
					.fill("(?, ?, ?)")
					.join(", ");

				await connection.query(
					`INSERT INTO recent_game_activity (user_id, image, text)
					 VALUES ${raPlaceholders}`,
					recent_activity_values,
				);
			}

			const meiliResponse = await fetch(`${process.env.MEILISEARCH_HOST}/indexes/users/documents`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${process.env.MEILISEARCH_INDEXES_KEY}`,
				},
				body: JSON.stringify(meiliUsers),
			});

			if (!meiliResponse.ok) {
				const errorText = await meiliResponse.text();
				console.error("Meilisearch sync failed:", errorText);
				return [500, { error: "Meilisearch sync failed" }];
			}

			return [200, { status: "OK" }];
		} catch (error) {
			console.error("Database operation failed:", error);
			return [500, { error: "Internal Server Error" }];
		} finally {
			await connection.release();
		}
	}
};
