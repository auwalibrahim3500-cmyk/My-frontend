const { Pool } = require('pg');
const env = require('./env');

const pool = new Pool(
  env.DATABASE_URL
    ? { connectionString: env.DATABASE_URL, ssl: env.DB_SSL ? { rejectUnauthorized: false } : false }
    : {
        host: env.DB_HOST,
        port: env.DB_PORT,
        database: env.DB_NAME,
        user: env.DB_USER,
        password: env.DB_PASSWORD,
        ssl: env.DB_SSL ? { rejectUnauthorized: false } : false,
      }
);

pool.on('error', (err) => {
  // eslint-disable-next-line no-console
  console.error('Unexpected PostgreSQL pool error:', err);
});

/** Convenience query wrapper */
async function query(text, params) {
  return pool.query(text, params);
}

/** Run a callback inside a transaction, automatically COMMIT/ROLLBACK */
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, withTransaction };
