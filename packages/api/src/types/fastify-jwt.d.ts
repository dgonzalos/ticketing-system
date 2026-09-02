import '@fastify/jwt';
import type { FastifyReply, FastifyRequest } from 'fastify';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { userId: string };
    user: { userId: string };
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Verifies the request's Bearer JWT, populating `request.user`; replies 401 on failure. */
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
