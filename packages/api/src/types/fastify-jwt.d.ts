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
    /**
     * Looks up `request.user.userId` live in the database and requires
     * `role === 'admin'`; replies 403 otherwise. Must run after
     * `authenticate` (`onRequest: [app.authenticate, app.requireAdmin]`),
     * since it depends on `request.user` being populated.
     */
    requireAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
