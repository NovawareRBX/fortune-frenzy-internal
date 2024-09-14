import { FastifyRequest, FastifyReply, HTTPMethods } from 'fastify';

export type AuthType = "none" | "server_key" | "master_key";

export interface Endpoint<
    Params = unknown,
    Body = unknown,
    Query = unknown,
    Headers = unknown
> {
    method: HTTPMethods;
    url: string;
    authType: AuthType;
    requiredHeaders?: Array<string>;
    callback: (request: FastifyRequest<{ Params: Params; Body: Body; Query?: Query; Headers?: Headers }>, reply: FastifyReply) => Promise<[status: number, data: any]>;
}