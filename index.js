const app = require('./app');
const env = require('./config/env');
const logger = require('./utils/logger');
const { pool } = require('./config/database');

async function start() {
  try {
    await pool.query('SELECT 1'); // fail fast if DB is unreachable
    logger.info('✅ Database connection established.');
  } catch (err) {
    logger.error('❌ Could not connect to database:', err.message);
    process.exit(1);
  }

  const server = app.listen(env.PORT, () => {
    logger.info(`🚀 AgriGuard AI API running on port ${env.PORT} [${env.NODE_ENV}]`);
  });

  const shutdown = async (signal) => {
    logger.info(`${signal} received, shutting down gracefully...`);
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start();
