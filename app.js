const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');

const env = require('./config/env');
const routes = require('./routes');
const { apiLimiter } = require('./middleware/rateLimiter');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

const app = express();

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({ origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(',') }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(apiLimiter);

// Serve uploaded scan images
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

app.use('/api/v1', routes);

app.get('/', (req, res) => res.json({ success: true, data: { name: 'AgriGuard AI API', version: '1.0.0' } }));

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
