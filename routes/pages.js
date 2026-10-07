// Public + authenticated pages: landing, dashboard, earn, redeem, legal.
const express = require('express');
const requireLogin = require('../middleware/requireLogin');
const config = require('../config');
const db = require('../db');

const router = express.Router();

router.get('/', (req, res) => res.render('index', { title: 'Earn rewards for surveys' }));

router.get('/dashboard', requireLogin, (req, res) => {
  const user = db.findUserById.get(req.user.id);
  const entries = db.recentLedger.all(req.user.id);
  const redemptions = db.userRedemptions.all(req.user.id);
  res.render('dashboard', { title: 'Dashboard', user, entries, redemptions });
});

router.get('/earn', requireLogin, (req, res) => {
  const user = db.findUserById.get(req.user.id);
  if (config.cpx.appId) {
    // Build the CPX Research offerwall iframe URL.
    //   ext_user_id = our user id (mandatory — CPX echoes it back as user_id
    //                 on the postback so we can credit the right account)
    //   secure_hash = md5("{ext_user_id}-{app_secure_hash}") (recommended)
    //   username / email = recommended (email lets CPX match duplicate users)
    const crypto = require('crypto');
    const extUserId = String(user.id);
    const params =
      `?app_id=${encodeURIComponent(config.cpx.appId)}` +
      `&ext_user_id=${encodeURIComponent(extUserId)}`;
    const secureParam = config.cpx.secureKey
      ? `&secure_hash=${crypto.createHash('md5').update(`${extUserId}-${config.cpx.secureKey}`, 'utf8').digest('hex')}`
      : '';
    const identityParam =
      `&username=${encodeURIComponent(user.name || '')}` +
      `&email=${encodeURIComponent(user.email || '')}`;
    const iframeUrl = `${config.cpx.offerwallUrl}${params}${secureParam}${identityParam}`;
    return res.render('earn', { title: 'Earn points', user, iframeUrl });
  }
  // No provider configured yet — show the in-app setup guide instead of a broken iframe.
  res.render('earn-setup', { title: 'Earn points', user });
});

const REDEEM_METHODS = ['PayPal', 'Gift Card', 'Bank Transfer', 'Mobile Money'];

router.get('/redeem', requireLogin, (req, res) => {
  const user = db.findUserById.get(req.user.id);
  res.render('redeem', {
    title: 'Redeem points',
    user,
    methods: REDEEM_METHODS,
    redemptions: db.userRedemptions.all(req.user.id),
    pointsPerUsd: config.pointsPerUsd,
    error: null,
    success: null,
  });
});

router.post('/redeem', requireLogin, (req, res, next) => {
  try {
    const user = db.findUserById.get(req.user.id);
    const method = (req.body.method || '').trim().slice(0, 60);
    const amount = parseInt(req.body.amount_points, 10);
    const detail = (req.body.account_detail || '').trim().slice(0, 300);

    const fail = (msg) =>
      res.status(400).render('redeem', {
        title: 'Redeem points',
        user,
        methods: REDEEM_METHODS,
        redemptions: db.userRedemptions.all(req.user.id),
        pointsPerUsd: config.pointsPerUsd,
        error: msg,
        success: null,
      });

    if (!REDEEM_METHODS.includes(method)) return fail('Please choose a payout method.');
    if (!Number.isInteger(amount) || amount <= 0) return fail('Amount must be a positive number of points.');
    if (amount > user.points_balance) return fail('You do not have enough points for that amount.');
    if (!detail) return fail('Please provide your account detail (e.g. your PayPal email).');

    // Reserve the points immediately so the balance cannot be double-spent
    // while the request awaits manual review.
    db.creditPoints(req.user.id, -amount, `Redemption request (${method})`, null);
    db.createRedemption.run(req.user.id, method, amount, detail);

    res.render('redeem', {
      title: 'Redeem points',
      user: db.findUserById.get(req.user.id),
      methods: REDEEM_METHODS,
      redemptions: db.userRedemptions.all(req.user.id),
      pointsPerUsd: config.pointsPerUsd,
      error: null,
      success: 'Request submitted! It is now PENDING manual review.',
    });
  } catch (err) {
    next(err);
  }
});

router.get('/privacy', (req, res) => res.render('privacy', { title: 'Privacy Policy' }));
router.get('/terms', (req, res) => res.render('terms', { title: 'Terms of Service' }));

module.exports = router;
