import { describe, expect, it } from 'vitest';
import { createReadOnlyDb } from '../../../../src/infrastructure/db/read-only-client.js';

/**
 * Connection-string validation only — nothing here opens a connection (`pg`
 * pools connect lazily). That the resulting session really refuses writes is
 * proven against a real database in `tests/integration/analytics.test.ts`.
 */
describe('createReadOnlyDb', () => {
  it.each([
    'postgresql://reader:pw@localhost:5432/ticketing_dev?options=-c%20default_transaction_read_only%3Doff',
    'postgres://reader:pw@localhost/db?sslmode=require&options=-c%20statement_timeout%3D0',
    'postgresql://reader:pw@localhost/db?options=',
  ])('rejects a URL that sets options, which would override read-only mode: %s', (url) => {
    expect(() => createReadOnlyDb(url)).toThrow(/must not set "options"/);
  });

  it.each(['host=localhost dbname=ticketing_dev options=-cdefault_transaction_read_only=off', 'not a url', 'mysql://localhost/db'])(
    'rejects a connection string that is not a postgres URL: %s',
    (connectionString) => {
      expect(() => createReadOnlyDb(connectionString)).toThrow(/must be a postgres/);
    }
  );

  it('accepts a plain postgres URL, including other parameters', async () => {
    const { pool } = createReadOnlyDb('postgresql://reader:pw@localhost:5432/ticketing_dev?sslmode=require');
    await pool.end();
  });
});
