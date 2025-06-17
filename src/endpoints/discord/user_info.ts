import { FastifyRequest } from "fastify";
import { packeter } from "../../utilities/packeter";
import { getMariaConnection } from "../../service/mariadb";
import { getRedisConnection } from "../../service/redis";
import smartQuery from "../../utilities/smartQuery";
import { z } from "zod";

let USER_FLAGS = [
	{
		flag: "DISCORD_EMPLOYEE",
		bitwise: 1 << 0,
	},
	{
		flag: "PARTNERED_SERVER_OWNER",
		bitwise: 1 << 1,
	},
	{
		flag: "HYPESQUAD_EVENTS",
		bitwise: 1 << 2,
	},
	{
		flag: "BUGHUNTER_LEVEL_1",
		bitwise: 1 << 3,
	},
	{
		flag: "HOUSE_BRAVERY",
		bitwise: 1 << 6,
	},
	{
		flag: "HOUSE_BRILLIANCE",
		bitwise: 1 << 7,
	},
	{
		flag: "HOUSE_BALANCE",
		bitwise: 1 << 8,
	},
	{
		flag: "EARLY_SUPPORTER",
		bitwise: 1 << 9,
	},
	{
		flag: "TEAM_USER",
		bitwise: 1 << 10,
	},
	{
		flag: "BUGHUNTER_LEVEL_2",
		bitwise: 1 << 14,
	},
	{
		flag: "VERIFIED_BOT",
		bitwise: 1 << 16,
	},
	{
		flag: "EARLY_VERIFIED_BOT_DEVELOPER",
		bitwise: 1 << 17,
	},
	{
		flag: "DISCORD_CERTIFIED_MODERATOR",
		bitwise: 1 << 18,
	},
	{
		flag: "BOT_HTTP_INTERACTIONS",
		bitwise: 1 << 19,
	},
	{
		flag: "SPAMMER",
		bitwise: 1 << 20,
	},
	{
		flag: "ACTIVE_DEVELOPER",
		bitwise: 1 << 22,
	},
	{
		flag: "QUARANTINED",
		bitwise: 17592186044416,
	},
];

function snowflakeToDate(id: string) {
	let temp = parseInt(id).toString(2);
	let length = 64 - temp.length;

	if (length > 0) for (let i = 0; i < length; i++) temp = "0" + temp;

	temp = temp.substring(0, 42);
	const date = new Date(parseInt(temp, 2) + 1420070400000);

	return date;
}

const discordUserParamsSchema = z.object({
	user_id: z.string().regex(/^\d+$/),
});

export default {
	method: "GET",
	url: "/discord/user/:user_id",
	authType: "none",
	callback: async function (
		request: FastifyRequest<{
			Params: { user_id: string };
		}>,
	): Promise<[number, any]> {
		const paramsParse = discordUserParamsSchema.safeParse(request.params);
		if (!paramsParse.success) {
			return [400, { error: "Invalid request", errors: paramsParse.error.flatten() }];
		}
		const { user_id } = paramsParse.data;

		const redis = await getRedisConnection();
		const cacheKey = `discord:user:${user_id}`;
		const cachedData = await redis.get(cacheKey);
		if (cachedData) {
			return [200, JSON.parse(cachedData)];
		}

		const result = await fetch(`https://discord.com/api/v10/users/${user_id}`, {
			headers: {
				Authorization: `Bot ${process.env.DISCORD_KEY}`,
			},
		});

		if (!result.ok) {
			return [404, { error: "User not found" }];
		}

		const json = await result.json();
		let public_flags: string[] = [];
		let premium_types: Record<number, string> = {
			0: "None",
			1: "Nitro Classic",
			2: "Nitro",
			3: "Nitro Basic",
		};

		USER_FLAGS.forEach((flag) => {
			if (json.public_flags & flag.bitwise) public_flags.push(flag.flag);
		});

		let avatarLink = null;
		if (json.avatar) avatarLink = `https://cdn.discordapp.com/avatars/${json.id}/${json.avatar}`;

		let bannerLink = null;
		if (json.banner) bannerLink = `https://cdn.discordapp.com/banners/${json.id}/${json.banner}?size=480`;

		const responseData = {
			id: json.id,
			created_at: snowflakeToDate(json.id),
			username: json.username,
			avatar: {
				id: json.avatar,
				link: avatarLink,
				is_animated: json.avatar != null && json.avatar.startsWith("a_"),
			},
			avatar_decoration: json.avatar_decoration_data,
			badges: public_flags,
			premium_type: premium_types[json.premium_type],
			accent_color: json.accent_color,
			global_name: json.global_name,
			banner: {
				id: json.banner,
				link: bannerLink,
				is_animated: json.banner != null && json.banner.startsWith("a_"),
				color: json.banner_color,
			},
			raw: json,
		};

		await redis.set(cacheKey, JSON.stringify(responseData), {
			EX: 3600,
		});

		return [200, responseData];
	}
};
