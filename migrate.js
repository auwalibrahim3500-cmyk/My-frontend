/**
 * Runs db/schema.sql against the configured database.
 * Usage: npm run db:migrate
 */
const fs = require('fs');
const path = require('path');
const { pool } = require('../src/config/database');

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const client = await pool.connect();
  try {
    console.log('▶ Running schema migration...');
    await client.query(sql);
    console.log('✅ Schema migration completed.');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
