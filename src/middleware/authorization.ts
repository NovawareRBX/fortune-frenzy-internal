import { FastifyRequest } from "fastify";
import { AuthType } from "../types/Endpoints";
import { getRedisConnection } from "../service/redis";

export async function authorization(
	request: FastifyRequest,
	authType: AuthType,
	requiredHeaders?: Array<string>,
): Promise<boolean> {
	const redis = await getRedisConnection();

	const validateHeaders = (headers: string[]): boolean => {
		for (const header of headers) {
			if (!request.headers[header]) return false;
		}
		return true;
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
		if (!validateHeaders(["x-api-key"])) return false;
		return request.headers["x-api-key"] === process.env.AUTHENTICATION_KEY;
	};

	if (requiredHeaders) validateHeaders(requiredHeaders);
	if (request.headers["internal-authentication"]) return await validateInternalAuth();
	if (authType === "key") return await validateServerKey();

	return true;
}
