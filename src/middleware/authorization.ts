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
			if (!request.headers[header]) {
				throw new AuthError(`Missing required header: ${header}`);
			}
		}
	};

	const validateInternalAuth = async (): Promise<boolean> => {
		const key = request.headers["internal-authentication"] as string;
		if (!key) throw new AuthError("Missing internal authentication key");

		const storedKey = await redis.get(`tempauth:${key}`);
		if (key !== storedKey) throw new AuthError("Invalid internal authentication key");

		await redis.del(`tempauth:${key}`);
		return true;
	};

	const validateServerKey = async (): Promise<boolean> => {
		if (request.headers["packeter-master-key"] === PACKETER_BYPASS_KEY) {
			return true;
		}

		validateHeaders(["server-id", "api-key"]);

		const serverId = request.headers["server-id"] as string;
		const apiKey = request.headers["api-key"] as string;

		const storedApiKey = await redis.get(`api_key:${serverId}`);
		const hashedApiKey = createHash("sha256").update(apiKey).digest("hex");

		if (hashedApiKey !== storedApiKey) {
			throw new AuthError("Invalid API key");
		}

		return true;
	};

	const validateMasterKey = (): boolean => {
		validateHeaders(["master-key"]);

		if (request.headers["master-key"] !== MASTER_KEY) {
			throw new AuthError("Invalid master key");
		}

		return true;
	};

	if (requiredHeaders) validateHeaders(requiredHeaders);
	if (request.headers["internal-authentication"]) return await validateInternalAuth();
	if (authType === "server_key") return await validateServerKey();
	if (authType === "master_key") return validateMasterKey();

	return true;
}
