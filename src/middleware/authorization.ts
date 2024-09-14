import { FastifyRequest } from "fastify";
import { AuthType } from "../types/Endpoints";
import { getRedisConnection } from "../service/redis";
import { createHash } from "crypto";

export async function authorization(
	request: FastifyRequest,
	authType: AuthType,
	requiredHeaders?: Array<string>,
): Promise<boolean> {
	// Extract environment variables once for reuse
	const MASTER_KEY = process.env.MASTER_KEY;
	const PACKETER_BYPASS_KEY = process.env.PACKETER_BYPASS_KEY;

	// Helper function to check for required headers
	const checkRequiredHeaders = (headers: Array<string>) => {
		for (const header of headers) {
			if (!request.headers[header]) {
				throw new Error(`Missing required header: ${header}`);
			}
		}
	};

	// Validate required headers
	if (requiredHeaders) {
		checkRequiredHeaders(requiredHeaders);
	}

	// Master key check
	if (request.headers["master-key"] === MASTER_KEY) {
		return true;
	}

	// Handle server_key authorization
	if (authType === "server_key") {
		if (request.headers["packeter-master-key"] === PACKETER_BYPASS_KEY) {
			return true;
		}

		// Validate server-id and api-key presence
		checkRequiredHeaders(["server-id", "api-key"]);

		// Retrieve stored API key from Redis
		const redis = await getRedisConnection();
		const server_id = request.headers["server-id"] as string;
		const api_key = request.headers["api-key"] as string;
		const stored_api_key = await redis.get(`api_key:${server_id}`);

		// Hash the incoming API key and compare it to the stored one
		const hashed_api_key = createHash("sha256").update(api_key).digest("hex");

		if (hashed_api_key !== stored_api_key) {
			throw new Error("Invalid API key");
		}

		return true;
	}

	// Handle master_key authorization
	if (authType === "master_key") {
		checkRequiredHeaders(["master-key"]);

		if (request.headers["master-key"] !== MASTER_KEY) {
			throw new Error("Invalid master key");
		}

		return true;
	}

	// Default return true if all checks pass
	return true;
}
