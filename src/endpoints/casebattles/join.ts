import { FastifyRequest } from "fastify";
import { getRedisConnection } from "../../service/redis";
import { CasebattlesRedisManager } from "../../service/casebattles-redis";
import { randomBytes } from "crypto";
import getUserInfo from "../../utilities/getUserInfo";
import { getMariaConnection } from "../../service/mariadb";
import { z } from "zod";

const BOT_INFO = [
	["david.baszucki", 24941],
	["ReeseMcBlox", 56449],
	["rbadam", 32345429],
	["twberg", 33067469],
	["Silent137", 71421065],
	["Squidcod", 41256555],
	["ContextLost", 136588219],
	["LPGhatguy", 576473],
	["100MillionDream", 100000013],
	["CodeWriter", 39876101],
	["Vooozy", 61380399],
	["iMightBeLying", 68465808],
	["ConvexHero", 66766775],
	["jmargh", 49626068],
	["chefdeltat", 481568196],
	["AnkhJay", 124695664],
	["0xBAADF00D", 99053014],
	["colnago82", 446966321],
	["1EnemyLeft", 73303401],
	["zeuxcg", 30068452],
	["Matt Dusek", 916],
	["sharpnine", 61666252],
	["Keith", 22],
	["akssoggywall", 80411868],
	["ProfBeetle", 89237852],
	["totbl", 16906083],
	["Tone", 264635],
	["Raeglyn", 16150324],
	["effward", 41101356],
	["TobotRobot", 20048521],
	["ostrichSized", 13965343],
	["Iron_Legion", 111179700],
	["BrightEyes", 504316],
	["Phil", 33904052],
	["Vaelan", 3239310],
	["RobloxsaurusRex", 89078114],
	["Terrisaurus", 163718057],
	["OldBaronMondo", 294598892],
	["SlingshotJunkie", 38324232],
	["InceptionTime", 7733466],
	["Briarroze", 55579189],
	["legoseed", 1184845],
	["Orca_Sparkles", 39882028],
	["SilentBuddy", 35081913],
	["Rootie_Groot", 28606349],
	["tarabyte", 17199995],
	["Coatp0cketninja", 35231885],
	["MajorTom4321", 1113299],
	["24RightAngles", 75857709],
	["zergii", 79808640],
	["Siekiera", 21969613],
	["rcartman", 292329719],
	["NirkZarek", 85222202],
	["KhalDragon", 84287697],
	["SFFCorgi", 83397468],
	["Valcrist", 82899742],
	["Tomarty", 1696758],
	["SCS", 560189],
	["Moarblox", 80131643],
	["Chrysolith", 84373160],
	["DoriGray", 72094244],
	["IsolatedEvent", 55311255],
	["NobleDragon", 6949935],
	["Tibbers24", 81336186],
	["FFJosh", 1311],
	["superfrostycane", 30598693],
	["CountVelcro", 28137935],
	["4runningwolves", 27861308],
	["GroundControll2", 2284059],
	["dapperbuffalo", 39871292],
	["EliteEinherjar", 69454679],
	["pulmoesflor", 26699190],
	["GloriousSalt", 29116915],
	["Vkriti", 69170840],
	["bellavour", 26714811],
	["goddessnoob", 9804369],
	["foster008", 1644345],
	["hawkington", 39861325],
	["Sorcus", 13268404],
	["Stickmasterluke", 80254],
	["OnlyTwentyCharacters", 28969907],
	["SolarCrane", 29373363],
	["Guru", 26542],
	["JParty", 87557825],
	["KnowDaGame", 42837397],
	["Lilly_S", 13094490],
	["Nightgaladeld", 8818419],
	["Hippie_ofDoom", 151751026],
	["penguinMikeDavid", 341692601],
	["chewbeccca", 341206540],
	["bakmamba74", 305088257],
	["Cherpl", 351675979],
];

const joinBodySchema = z.object({
	user_id: z.number(),
	position: z.number(),
	client_seed: z.string(),
});

const joinParamsSchema = z.object({
	id: z.string(),
});

export default {
	method: "POST",
	url: "/casebattles/join/:id",
	authType: "key",
	callback: async function (
		request: FastifyRequest<{
			Body: {
				user_id: number;
				position: number;
				client_seed: string;
			};
			Params: { id: string };
		}>,
	): Promise<[number, any]> {
		const bodyParse = joinBodySchema.safeParse(request.body);
		const paramsParse = joinParamsSchema.safeParse(request.params);
		if (!bodyParse.success || !paramsParse.success) {
			return [400, { message: "Invalid request", errors: {
				body: !bodyParse.success ? bodyParse.error.flatten() : undefined,
				params: !paramsParse.success ? paramsParse.error.flatten() : undefined,
			}}];
		}

		const { user_id, position, client_seed } = bodyParse.data;
		const { id: casebattleId } = paramsParse.data;

		const redis = await getRedisConnection();
		if (!redis) return [500, { message: "Failed to connect to Redis" }];
		const connection = await getMariaConnection();
		if (!connection) return [500, { message: "Failed to connect to MariaDB" }];

		const casebattlesRedisManager = new CasebattlesRedisManager(redis, request.server);
		const casebattle = await casebattlesRedisManager.getCaseBattle(casebattleId);
		if (!casebattle) {
			return [404, { message: "Case battle not found" }];
		}

		if (casebattle.status !== "waiting_for_players") {
			return [400, { message: "Case battle is not accepting players" }];
		}

		const userInfo = await getUserInfo(connection, [user_id.toString()]);
		if (!userInfo || userInfo.length === 0) {
			return [400, { message: "Invalid user ID" }];
		}

		const isCreator = casebattle.players[0].id === user_id.toString();
		const isAlreadyJoined = casebattle.players.some((player) => player.id === user_id.toString());

		if (isAlreadyJoined && !isCreator) {
			return [400, { message: "User is already in the case battle" }];
		}

		const maxPlayers = casebattle.team_mode
			.split("v")
			.map(Number)
			.reduce((sum, players) => sum + players, 0);
		if (
			position < 0 ||
			position > maxPlayers ||
			casebattle.players.some((player) => player.position === position)
		) {
			return [400, { message: "Invalid or taken position" }];
		}

		const botInfo = BOT_INFO[Math.floor(Math.random() * BOT_INFO.length)];
		const newPlayer = isCreator
			? {
					id: `bot_${botInfo[1]}`,
					username: botInfo[0].toString(),
					display_name: botInfo[0].toString(),
					position,
					bot: true,
					client_seed: randomBytes(16).toString("hex"),
			  }
			: {
					id: userInfo[0].id.toString(),
					username: userInfo[0].username,
					display_name: userInfo[0].display_name,
					position,
					bot: false,
					client_seed,
			  };

		const success = await casebattlesRedisManager.joinCaseBattle(casebattleId, newPlayer);
		if (!success) {
			return [409, { message: "Failed to join case battle, it may have started, filled up, or been modified" }];
		}

		const newData = await casebattlesRedisManager.getCaseBattle(casebattleId);
		if (newData?.players.length === maxPlayers) {
			casebattlesRedisManager.startCaseBattle(casebattleId);
		}

		connection.release();
		return [200, { status: "OK", data: newData }];
	},
};
