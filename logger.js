const env = require('../config/env');

const ts = () => new Date().toISOString();

module.exports = {
  info: (...args) => console.log(`[${ts()}] INFO`, ...args),
  warn: (...args) => console.warn(`[${ts()}] WARN`, ...args),
  error: (...args) => console.error(`[${ts()}] ERROR`, ...args),
  debug: (...args) => { if (env.NODE_ENV !== 'production') console.debug(`[${ts()}] DEBUG`, ...args); },
};
