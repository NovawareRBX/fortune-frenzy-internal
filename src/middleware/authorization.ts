import { FastifyRequest } from "fastify";
import { AuthType } from "../types/Endpoints";
import { getRedisConnection } from "../service/redis";
import { createHash, randomBytes } from "crypto";

export async function authorization(request: FastifyRequest, authType: AuthType, requiredHeaders?: Array<string>): Promise<boolean> {
    if (requiredHeaders) {
        for (const header of requiredHeaders) {
            if (!request.headers[header]) {
                throw new Error(`Missing required header: ${header}`);
            }
        }
    }

    if (request.headers["master-key"] === process.env.MASTER_KEY) {
        return true;
    }

    if (authType === "server_key") {
        if (request.headers["packeter-master-key"] === process.env.PACKETER_BYPASS_KEY) {
            return true;
        }

        if (!request.headers["server-id"]) {
            console.log(request.headers);
            throw new Error("Missing required header: server-id");
        }

        if (!request.headers["api-key"]) {
            console.log(request.headers);
            throw new Error("Missing required header: api-key");
        }

        const redis = await getRedisConnection();

        const server_id = request.headers["server-id"] as string;
        const api_key = request.headers["api-key"] as string;
        const stored_api_key = await redis.get(`api_key:${server_id}`);
        const hashed_api_key = createHash("sha256").update(api_key).digest("hex");

        if (hashed_api_key !== stored_api_key) {
            throw new Error("Invalid API key");
        }

        return true;
    } else if (authType === "master_key") {
        if (!request.headers["master-key"]) {
            throw new Error("Missing required header: master-key");
        }

        if (request.headers["master-key"] !== process.env.MASTER_KEY) {
            throw new Error("Invalid master key");
        }

        return true;
    }

    return true;
}