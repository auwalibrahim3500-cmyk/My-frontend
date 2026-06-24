const express = require('express');
const Joi = require('joi');
const { query, withTransaction } = require('../config/database');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const validate = require('../middleware/validate');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');

const router = express.Router();

// ── GET /market/products?category=&dealerId= ──────────────────────────────
router.get(
  '/products',
  validate({ query: Joi.object({ category: Joi.string().max(60).optional(), dealerId: Joi.string().uuid().optional(), forDisease: Joi.string().optional() }) }),
  asyncHandler(async (req, res) => {
    const conditions = []; const params = []; let i = 1;
    if (req.query.category) { conditions.push(`p.category = $${i++}`); params.push(req.query.category); }
    if (req.query.dealerId) { conditions.push(`p.dealer_id = $${i++}`); params.push(req.query.dealerId); }
    if (req.query.forDisease) { conditions.push(`d.slug = $${i++}`); params.push(req.query.forDisease); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await query(
      `SELECT p.*, dl.name AS dealer_name, dl.lga AS dealer_lga, dl.latitude AS dealer_lat, dl.longitude AS dealer_lon
       FROM products p
       LEFT JOIN dealers dl ON dl.id = p.dealer_id
       LEFT JOIN diseases d ON d.id = p.recommended_for_disease_id
       ${where} ORDER BY p.created_at DESC`,
      params
    );
    res.json({ success: true, data: rows.map(serializeProduct) });
  })
);

// ── GET /market/prices?state=Kano — live price ticker ─────────────────────
router.get(
  '/prices',
  validate({ query: Joi.object({ state: Joi.string().max(60).default('Kano') }) }),
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT DISTINCT ON (crop_name) * FROM market_prices WHERE state = $1 ORDER BY crop_name, recorded_at DESC`,
      [req.query.state]
    );
    res.json({ success: true, data: rows.map(serializePrice) });
  })
);

// ── GET /market/dealers?lat=&lon=&radiusKm= ────────────────────────────────
router.get(
  '/dealers',
  validate({ query: Joi.object({ lat: Joi.number().optional(), lon: Joi.number().optional() }) }),
  asyncHandler(async (req, res) => {
    const { rows } = await query('SELECT * FROM dealers ORDER BY rating DESC');
    let dealers = rows.map(serializeDealer);
    if (req.query.lat !== undefined && req.query.lon !== undefined) {
      dealers = dealers
        .map((d) => ({ ...d, distanceKm: d.latitude && d.longitude ? Math.round(haversine(req.query.lat, req.query.lon, d.latitude, d.longitude) * 10) / 10 : null }))
        .sort((a, b) => (a.distanceKm ?? 999) - (b.distanceKm ?? 999));
    }
    res.json({ success: true, data: dealers });
  })
);

// ── POST /market/orders — buy a product ────────────────────────────────────
router.post(
  '/orders',
  requireAuth,
  validate({
    body: Joi.object({
      productId: Joi.string().uuid().required(),
      quantity: Joi.number().integer().min(1).default(1),
      deliveryAddress: Joi.string().max(300).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { productId, quantity, deliveryAddress } = req.body;

    const order = await withTransaction(async (client) => {
      const { rows: productRows } = await client.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [productId]);
      if (!productRows.length) throw ApiError.notFound('Product not found.');
      const product = productRows[0];

      if (product.stock_status === 'out_of_stock') throw ApiError.badRequest('This product is currently out of stock.');
      if (product.stock_units !== null && product.stock_units < quantity) {
        throw ApiError.badRequest(`Only ${product.stock_units} units available.`);
      }

      const totalPrice = Number(product.price) * quantity;
      const { rows: orderRows } = await client.query(
        `INSERT INTO orders (user_id,product_id,dealer_id,quantity,unit_price,total_price,delivery_address)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [req.user.id, productId, product.dealer_id, quantity, product.price, totalPrice, deliveryAddress || null]
      );

      if (product.stock_units !== null) {
        const newStock = product.stock_units - quantity;
        await client.query(
          `UPDATE products SET stock_units = $1, stock_status = $2 WHERE id = $3`,
          [newStock, newStock <= 0 ? 'out_of_stock' : newStock <= 10 ? 'limited' : 'in_stock', productId]
        );
      }

      return orderRows[0];
    });

    res.status(201).json({ success: true, data: serializeOrder(order) });
  })
);

// ── GET /market/orders — order history ─────────────────────────────────────
router.get('/orders', requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC', [req.user.id]);
  res.json({ success: true, data: rows.map(serializeOrder) });
}));

// ── GET /market/credit — user's credit profile ──────────────────────────────
router.get('/credit', requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM user_credit WHERE user_id = $1', [req.user.id]);
  if (!rows.length) throw ApiError.notFound('Credit profile not found.');
  res.json({ success: true, data: serializeCredit(rows[0]) });
}));

// ── GET /market/loans/packages ────────────────────────────────────────────
router.get('/loans/packages', asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM loan_packages ORDER BY amount');
  res.json({ success: true, data: rows.map(serializeLoanPackage) });
}));

// ── POST /market/loans/apply ──────────────────────────────────────────────
router.post(
  '/loans/apply',
  requireAuth,
  validate({
    body: Joi.object({
      loanPackageId: Joi.string().uuid().required(),
      amountRequested: Joi.number().positive().required(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { loanPackageId, amountRequested } = req.body;

    const credit = await withTransaction(async (client) => {
      const { rows: creditRows } = await client.query('SELECT * FROM user_credit WHERE user_id = $1 FOR UPDATE', [req.user.id]);
      if (!creditRows.length) throw ApiError.notFound('Credit profile not found.');
      const cr = creditRows[0];
      const available = Number(cr.credit_limit) - Number(cr.credit_used);

      // Simple auto-decision: approve if within available credit limit, otherwise pending manual review.
      const autoApprove = available >= amountRequested && amountRequested <= 100000;
      const status = autoApprove ? 'approved' : 'pending';

      const { rows: appRows } = await client.query(
        `INSERT INTO loan_applications (user_id,loan_package_id,amount_requested,status,credit_score_at_apply,decided_at)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [req.user.id, loanPackageId, amountRequested, status, cr.credit_score_label, autoApprove ? new Date() : null]
      );

      if (autoApprove) {
        await client.query('UPDATE user_credit SET credit_used = credit_used + $1, updated_at = now() WHERE user_id = $2', [amountRequested, req.user.id]);
      }

      return appRows[0];
    });

    res.status(201).json({ success: true, data: serializeLoanApplication(credit) });
  })
);

// ── GET /market/loans/applications ────────────────────────────────────────
router.get('/loans/applications', requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM loan_applications WHERE user_id = $1 ORDER BY created_at DESC', [req.user.id]);
  res.json({ success: true, data: rows.map(serializeLoanApplication) });
}));

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function serializeProduct(p) {
  return {
    id: p.id, name: p.name, category: p.category, price: Number(p.price), stockStatus: p.stock_status,
    stockUnits: p.stock_units, description: p.description, emoji: p.image_emoji, deliveryNote: p.delivery_note,
    dealer: p.dealer_id ? { id: p.dealer_id, name: p.dealer_name, lga: p.dealer_lga, latitude: p.dealer_lat, longitude: p.dealer_lon } : null,
  };
}
function serializePrice(p) {
  return {
    id: p.id, cropName: p.crop_name, localName: p.local_name, emoji: p.emoji, state: p.state, marketName: p.market_name,
    pricePerKg: Number(p.price_per_kg), changeAmount: Number(p.change_amount), changePercent: Number(p.change_percent),
    changeDirection: p.change_direction, recordedAt: p.recorded_at,
  };
}
function serializeDealer(d) {
  return { id: d.id, name: d.name, state: d.state, lga: d.lga, address: d.address, latitude: d.latitude, longitude: d.longitude, phone: d.phone, rating: Number(d.rating) };
}
function serializeOrder(o) {
  return {
    id: o.id, productId: o.product_id, dealerId: o.dealer_id, quantity: o.quantity,
    unitPrice: Number(o.unit_price), totalPrice: Number(o.total_price), status: o.status,
    deliveryAddress: o.delivery_address, createdAt: o.created_at,
  };
}
function serializeCredit(c) {
  return {
    creditLimit: Number(c.credit_limit), creditUsed: Number(c.credit_used), creditAvailable: Number(c.credit_limit) - Number(c.credit_used),
    creditScoreLabel: c.credit_score_label, monthlyRatePct: Number(c.monthly_rate_pct), maxTermMonths: c.max_term_months,
    disbursementHours: c.disbursement_hours, updatedAt: c.updated_at,
  };
}
function serializeLoanPackage(p) {
  return { id: p.id, name: p.name, description: p.description, amount: Number(p.amount), termMonths: p.term_months, interestRateMonthly: Number(p.interest_rate_monthly), category: p.category };
}
function serializeLoanApplication(a) {
  return {
    id: a.id, loanPackageId: a.loan_package_id, amountRequested: Number(a.amount_requested), status: a.status,
    creditScoreAtApply: a.credit_score_at_apply, decisionNote: a.decision_note, createdAt: a.created_at, decidedAt: a.decided_at,
  };
}

module.exports = router;
