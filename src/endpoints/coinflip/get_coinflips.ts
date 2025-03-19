import { FastifyRequest } from "fastify";
import { getRedisConnection } from "../../service/redis";

export default async function (
	request: FastifyRequest<{
		Querystring: { server_id?: string };
	}>,
): Promise<[number, any]> {
	try {
		const redis = await getRedisConnection();
		const { server_id } = request.query;

		const coinflipIds = server_id
			? await redis.sUnion(["coinflips:global", `coinflips:server:${server_id}`])
			: await redis.sMembers("coinflips:global");

		if (!coinflipIds || coinflipIds.length === 0) {
			return [200, { status: "OK", coinflips: [] }];
		}

		const coinflipsRaw = await redis.mGet(coinflipIds.map((id) => `coinflip:${id}`));
		const coinflips = coinflipsRaw.map((json) => (json ? JSON.parse(json) : null)).filter((c) => c !== null);
		const filteredCoinflips = coinflips.filter((cf) => {
			if (cf.type === "global") return true;
			if (cf.type === "server" && cf.server_id === server_id) return true;
			return false;
		});

		return [200, { status: "OK", coinflips: filteredCoinflips }];
	} catch (error) {
		return [500, { error: "Failed to get coinflips" }];
	}
}
