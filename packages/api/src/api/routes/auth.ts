import type { FastifyPluginAsync } from 'fastify';
import { z, ZodError } from 'zod';
import type { AuthResponseDto } from '@ticketing-system/shared';
import { EmailAlreadyRegisteredError, InvalidCredentialsError } from '../../domain/common/errors/domain-errors.js';
import type { User, UserService } from '../../domain/users/user-service.js';

export interface AuthRoutesOptions {
  userService: UserService;
}

interface ErrorResponse {
  error: string;
}

function toAuthResponse({ user, token }: { user: User; token: string }): AuthResponseDto {
  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt.toISOString(),
      role: user.role,
    },
    token,
  };
}

const signupBodySchema = z
  .object({
    email: z.string().email(),
    password: z.string().min(8),
    passwordConfirm: z.string(),
  })
  .refine((data) => data.password === data.passwordConfirm, {
    message: 'Passwords do not match',
    path: ['passwordConfirm'],
  });
type SignupBody = z.infer<typeof signupBodySchema>;

const loginBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
type LoginBody = z.infer<typeof loginBodySchema>;

/**
 * Account creation and login. All business logic (password hashing,
 * verification, JWT issuance) is delegated to the injected
 * {@link UserService} — this plugin only validates input and maps domain
 * results/errors to HTTP responses.
 */
export const authRoutes: FastifyPluginAsync<AuthRoutesOptions> = async (app, { userService }) => {
  /**
   * POST /auth/signup
   *
   * Registers a new account and logs it in immediately.
   *
   * Body: `{ email, password, passwordConfirm }`.
   * Responses: 201 with `{ user, token }`, 400 for a malformed body
   * (invalid email, password under 8 chars, or passwordConfirm mismatch),
   * 409 if the email is already registered.
   */
  app.post<{ Body: SignupBody; Reply: AuthResponseDto | ErrorResponse }>('/auth/signup', async (request, reply) => {
    let body: SignupBody;
    try {
      body = signupBodySchema.parse(request.body);
    } catch (err) {
      if (err instanceof ZodError) {
        return reply.code(400).send({ error: 'Invalid request body' });
      }
      throw err;
    }

    try {
      const result = await userService.signup(body.email, body.password);
      return reply.code(201).send(toAuthResponse(result));
    } catch (err) {
      if (err instanceof EmailAlreadyRegisteredError) {
        return reply.code(409).send({ error: err.message });
      }
      throw err;
    }
  });

  /**
   * POST /auth/login
   *
   * Verifies email + password and logs in on success.
   *
   * Body: `{ email, password }`.
   * Responses: 200 with `{ user, token }`, 400 for a malformed body, 401 if
   * the email doesn't match any account or the password is wrong (same
   * message for both — doesn't leak which emails have accounts).
   */
  app.post<{ Body: LoginBody; Reply: AuthResponseDto | ErrorResponse }>('/auth/login', async (request, reply) => {
    let body: LoginBody;
    try {
      body = loginBodySchema.parse(request.body);
    } catch (err) {
      if (err instanceof ZodError) {
        return reply.code(400).send({ error: 'Invalid request body' });
      }
      throw err;
    }

    try {
      const result = await userService.login(body.email, body.password);
      return reply.code(200).send(toAuthResponse(result));
    } catch (err) {
      if (err instanceof InvalidCredentialsError) {
        return reply.code(401).send({ error: err.message });
      }
      throw err;
    }
  });
};
