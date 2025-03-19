import { FastifyRequest } from "fastify";
import { AuthType } from "../types/Endpoints";
import { getRedisConnection } from "../service/redis";

export async function authorization(
	request: FastifyRequest,
	authType: AuthType,
	requiredHeaders?: Array<string>,
): Promise<boolean> {
	const redis = await getRedisConnection();

	const validateHeaders = (headers: string[]) => {
		for (const header of headers) {
			if (!request.headers[header]) return false;
		}
	};

	const validateInternalAuth = async (): Promise<boolean> => {
		const key = request.headers["internal-authentication"] as string;
		if (!key) return false;

		const storedKey = await redis.get(`tempauth:${key}`);
		if (key !== storedKey) return false;

		await redis.del(`tempauth:${key}`);
		return true;
	};

	const validateServerKey = async (): Promise<boolean> => {
		validateHeaders(["x-api-key"]);
		if (request.headers["x-api-key"] === process.env.AUTHENTICATION_KEY) return true;
		return false;
	};

	if (requiredHeaders) validateHeaders(requiredHeaders);
	if (request.headers["internal-authentication"]) return await validateInternalAuth();
	if (authType === "key") return await validateServerKey();

	return true;
}
