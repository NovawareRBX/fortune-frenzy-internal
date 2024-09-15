import { FastifyRequest } from "fastify";
import { AuthType } from "../types/Endpoints";
import { getRedisConnection } from "../service/redis";
import { createHash } from "crypto";

export async function authorization(
	request: FastifyRequest,
	authType: AuthType,
	requiredHeaders?: Array<string>,
): Promise<boolean> {
	const MASTER_KEY = process.env.MASTER_KEY;
	const PACKETER_BYPASS_KEY = process.env.PACKETER_BYPASS_KEY;

	const checkRequiredHeaders = (headers: Array<string>) => {
		for (const header of headers) {
			if (!request.headers[header]) {
				throw new Error(`Missing required header: ${header}`);
			}
		}
	};

	if (requiredHeaders) {
		checkRequiredHeaders(requiredHeaders);
	}

	if (authType === "server_key") {
		if (request.headers["packeter-master-key"] === PACKETER_BYPASS_KEY) {
			return true;
		}

		checkRequiredHeaders(["server-id", "api-key"]);

		const redis = await getRedisConnection();
		const server_id = request.headers["server-id"] as string;
		const api_key = request.headers["api-key"] as string;
		const stored_api_key = await redis.get(`api_key:${server_id}`);

		const hashed_api_key = createHash("sha256").update(api_key).digest("hex");

		if (hashed_api_key !== stored_api_key) {
			throw new Error("Invalid API key");
		}

		return true;
	}

	if (authType === "master_key") {
		checkRequiredHeaders(["master-key"]);

		if (request.headers["master-key"] !== MASTER_KEY) {
			throw new Error("Invalid master key");
		}

		return true;
	}

	return true;
}
