const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');
const env = require('../config/env');

function notFoundHandler(req, res, next) {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let { statusCode, message, details } = err;

  if (!statusCode) {
    statusCode = 500;
    message = env.NODE_ENV === 'production' ? 'Internal server error' : err.message;
  }

  if (err.code === '23505') { // Postgres unique violation
    statusCode = 409;
    message = 'A record with this value already exists.';
  } else if (err.code === '23503') { // foreign key violation
    statusCode = 400;
    message = 'Related resource does not exist.';
  }

  if (statusCode >= 500) {
    logger.error(err);
  }

  res.status(statusCode).json({
    success: false,
    error: {
      message,
      ...(details ? { details } : {}),
      ...(env.NODE_ENV !== 'production' && statusCode >= 500 ? { stack: err.stack } : {}),
    },
  });
}

module.exports = { notFoundHandler, errorHandler };
