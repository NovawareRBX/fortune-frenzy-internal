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
			win_rate: number;
			biggest_win: number;
			total_plays: number;
			favourite_mode: string;
			time_played: number;
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
		!request.body.every(
			(user) =>
				typeof user.user_id === "string" &&
				typeof user.name === "string" &&
				typeof user.display_name === "string" &&
				typeof user.total_cash_earned === "number" &&
				typeof user.total_cash_spent === "number" &&
				typeof user.win_rate === "number" &&
				typeof user.biggest_win === "number" &&
				typeof user.total_plays === "number" &&
				Number.isInteger(user.total_plays) &&
				typeof user.favourite_mode === "string" &&
				typeof user.time_played === "number" &&
				user.time_played >= 0 &&
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
		const placeholders = users.map(() => "(?, ?, ?, ?)").join(", ");
		const values: any[] = [];
		const recent_activity_values: any[] = [];

		users.forEach((u) => {
			const stats = {
				total_cash_earned: u.total_cash_earned,
				total_cash_spent: u.total_cash_spent,
				win_rate: u.win_rate,
				biggest_win: u.biggest_win,
				total_plays: u.total_plays,
				favourite_mode: u.favourite_mode,
				time_played: u.time_played,
			};

			values.push(u.user_id, u.name, u.display_name, JSON.stringify(stats));

			u.recent_activity.forEach((activity) => {
				recent_activity_values.push(u.user_id, activity.icon, activity.text);
			});
		});

		await connection.query(
			`
		  INSERT INTO users (user_id, name, displayName, statistics)
		  VALUES ${placeholders}
		  ON DUPLICATE KEY UPDATE
			name = VALUES(name),
			displayName = VALUES(displayName),
			statistics = VALUES(statistics)
		`,
			values,
		);

		if (recent_activity_values.length > 0) {
			const raPlaceholders = [];
			for (let i = 0; i < recent_activity_values.length; i += 3) {
				raPlaceholders.push("(?, ?, ?)");
			}

			await connection.query(
				`INSERT INTO recent_game_activity (user_id, image, text)
			   VALUES ${raPlaceholders.join(", ")}`,
				recent_activity_values,
			);
		}

		return [200, { status: "OK" }];
	} catch (error) {
		console.error(error);
		return [500, { error: "Internal Server Error" }];
	} finally {
		await connection.release();
	}
}
