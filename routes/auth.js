// Email/password signup & login, Google OAuth entry points, logout.
const express = require('express');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const passport = require('../lib/passport');
const config = require('../config');
const db = require('../db');

const router = express.Router();

// Brute-force protection on the auth endpoints.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many attempts — please try again in 15 minutes.',
});

const SALT_ROUNDS = 12;
const emailOk = (e) =>
  typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());

router.get('/signup', (req, res) =>
  res.render('signup', { title: 'Sign up', error: null, googleConfigured: config.google.configured })
);

router.get('/login', (req, res) =>
  res.render('login', {
    title: 'Log in',
    error: null,
    notice: req.query.notice || null,
    next: req.query.next || '/dashboard',
    googleConfigured: config.google.configured,
  })
);

router.post('/signup', authLimiter, async (req, res, next) => {
  try {
    const email = (req.body.email || '').trim().toLowerCase();
    const password = req.body.password || '';
    const name = (req.body.name || '').trim().slice(0, 120);
    const render = (error, status = 400) =>
      res.status(status).render('signup', { title: 'Sign up', error, googleConfigured: config.google.configured });

    if (!emailOk(email)) return render('Please enter a valid email address.');
    if (password.length < 8) return render('Password must be at least 8 characters.');
    if (db.findUserByEmail.get(email))
      return render('An account with that email already exists. Try logging in instead.');

    const password_hash = await bcrypt.hash(password, SALT_ROUNDS);
    const info = db.createUser.run({ email, password_hash, google_id: null, name: name || null });
    const user = db.findUserById.get(info.lastInsertRowid);
    req.login(user, (err) => (err ? next(err) : res.redirect('/dashboard')));
  } catch (err) {
    next(err);
  }
});

router.post('/login', authLimiter, async (req, res, next) => {
  try {
    const email = (req.body.email || '').trim().toLowerCase();
    const password = req.body.password || '';
    const nextUrl = typeof req.body.next === 'string' && req.body.next.startsWith('/') ? req.body.next : '/dashboard';
    const fail = () =>
      res.status(401).render('login', {
        title: 'Log in',
        error: 'Invalid email or password.',
        notice: null,
        next: nextUrl,
        googleConfigured: config.google.configured,
      });

    const user = db.findUserByEmail.get(email);
    // Users who signed up via Google only have no password — same generic error.
    if (!user || !user.password_hash) return fail();
    if (!(await bcrypt.compare(password, user.password_hash))) return fail();

    // "Remember me": checked = stay logged in for 30 days; unchecked = the
    // login lasts only until the browser is closed. Set after req.login()
    // so it applies to the final (regenerated) session.
    const remember = req.body.remember === '1';
    req.login(user, (err) => {
      if (err) return next(err);
      if (remember) {
        req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
      } else {
        req.session.cookie.expires = false; // browser-session cookie
      }
      res.redirect(nextUrl);
    });
  } catch (err) {
    next(err);
  }
});

// Google OAuth 2.0. Wired up only when credentials exist; otherwise the
// buttons in the UI never point here, but direct hits get a helpful page
// instead of a crash.
if (config.google.configured) {
  router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
  router.get(
    '/google/callback',
    passport.authenticate('google', {
      failureRedirect: '/login?notice=' + encodeURIComponent('Google sign-in failed. Please try again.'),
    }),
    (req, res) => res.redirect('/dashboard')
  );
} else {
  const notConfigured = (req, res) =>
    res.status(503).render('oauth-not-configured', { title: 'Google sign-in not configured' });
  router.get('/google', notConfigured);
  router.get('/google/callback', notConfigured);
}

router.post('/logout', (req, res, next) => {
  req.logout((err) => (err ? next(err) : res.redirect('/')));
});

module.exports = router;
