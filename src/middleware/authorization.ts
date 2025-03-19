import { FastifyRequest } from "fastify";
import { AuthType } from "../types/Endpoints";
import { getRedisConnection } from "../service/redis";
import { createHash } from "crypto";

class AuthError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AuthError";
	}
}

export async function authorization(
	request: FastifyRequest,
	authType: AuthType,
	requiredHeaders?: Array<string>,
): Promise<boolean> {
	const MASTER_KEY = process.env.MASTER_KEY || "";
	const PACKETER_BYPASS_KEY = process.env.PACKETER_BYPASS_KEY || "";

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
		if (request.headers["packeter-master-key"] === PACKETER_BYPASS_KEY) return true;
		validateHeaders(["server-id", "api-key"]);

		if (request.headers["api-key"] === process.env.ROBLOX_KEY) return true;
		return false;
	};

	const validateMasterKey = (): boolean => {
		validateHeaders(["master-key"]);

		if (request.headers["master-key"] !== MASTER_KEY) return false;
		return true;
	};

	if (requiredHeaders) validateHeaders(requiredHeaders);
	if (request.headers["internal-authentication"]) return await validateInternalAuth();
	if (authType === "server_key") return await validateServerKey();
	if (authType === "master_key") return validateMasterKey();

	return true;
}
