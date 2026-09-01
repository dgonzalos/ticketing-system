import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';

const app = Fastify({
  logger: true
});

// Plugins
await app.register(helmet);
await app.register(cors, { origin: '*' });

// Health check
app.get('/health', async (request, reply) => {
  return { status: 'ok' };
});

// Start server
const PORT = process.env.PORT || 3000;
await app.listen({ port: PORT, host: '0.0.0.0' });

console.log(`✅ Server running on http://localhost:${PORT}`);