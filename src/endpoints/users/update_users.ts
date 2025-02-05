import { FastifyRequest } from "fastify";
import { getMariaConnection } from "../../service/mariadb";

export default async function (
	request: FastifyRequest<{
		Body: {
			user_id: string;
			name: string;
			display_name: string;
			total_cash_earned: number;
			total_cash_spent: number;
			current_cash: number;
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
	if (
		!request.body ||
		!Array.isArray(request.body) ||
		request.body.length === 0 ||
		!request.body.every(
			(user) =>
				typeof user.user_id === "string" &&
				typeof user.name === "string" &&
				typeof user.display_name === "string" &&
				typeof user.total_cash_earned === "number" &&
				typeof user.total_cash_spent === "number" &&
				typeof user.current_cash === "number" &&
				typeof user.win_rate === "number" &&
				typeof user.biggest_win === "number" &&
				typeof user.total_plays === "number" &&
				typeof user.favourite_mode === "string" &&
				typeof user.time_played === "number" &&
				typeof user.xp === "number" &&
				Array.isArray(user.recent_activity) &&
				user.recent_activity.every(
					(activity) => typeof activity.text === "string" && typeof activity.icon === "string",
				),
		)
	) {
		return [400, { error: "Invalid request body" }];
	}

	const connection = await getMariaConnection();
	if (!connection) {
		return [500, { error: "Failed to connect to the database" }];
	}

	try {
		const users = request.body;
		const placeholders = users.map(() => "(?, ?, ?, ?, ?)").join(", ");
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

			values.push(u.user_id, u.name, u.display_name, JSON.stringify(stats), u.current_cash);

			u.recent_activity.forEach((activity) => {
				recent_activity_values.push(u.user_id, activity.icon, activity.text);
			});

			// Prepare user data for Meilisearch indexing
			meiliUsers.push({
				id: u.user_id,
				name: u.name,
				display_name: u.display_name,
				current_cash: u.current_cash,
			});
		});

		// Insert/update users in MariaDB
		await connection.query(
			`INSERT INTO users (user_id, name, display_name, statistics, current_cash)
			 VALUES ${placeholders}
			 ON DUPLICATE KEY UPDATE
				 name = VALUES(name),
				 display_name = VALUES(display_name),
				 statistics = VALUES(statistics),
				 current_cash = VALUES(current_cash)`,
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
