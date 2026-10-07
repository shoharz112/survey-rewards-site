// Email/password signup & login, email verification codes, Google OAuth,
// logout.
const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const passport = require('../lib/passport');
const config = require('../config');
const db = require('../db');
const { sendVerificationEmail } = require('../lib/mailer');

const router = express.Router();

// Brute-force protection on the auth endpoints.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many attempts — please try again in 15 minutes.',
});

// Tighter limits for code guessing and code re-sends.
const verifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many attempts — please try again in 15 minutes.',
});
const resendLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many codes requested — please try again later.',
});

// --- Email verification codes ---
const CODE_TTL_MS = 15 * 60 * 1000; // codes expire after 15 minutes

const generateCode = () => String(crypto.randomInt(100000, 1000000)); // 6 digits
const hashCode = (code) =>
  crypto.createHash('sha256').update(code, 'utf8').digest('hex');

// Stores a fresh code for the user and emails it. Returns the plain code
// (only for dev-mode logging; never send it to the client).
async function issueVerificationCode(user) {
  const code = generateCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MS)
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');
  db.setVerifyCode.run(hashCode(code), expiresAt, user.id);
  await sendVerificationEmail(user.email, code);
}

function codeExpired(user) {
  if (!user.verify_code_expires_at) return true;
  return Date.now() > Date.parse(user.verify_code_expires_at.replace(' ', 'T') + 'Z');
}

function verifyRedirect(email, notice) {
  return (
    '/auth/verify?email=' +
    encodeURIComponent(email) +
    (notice ? '&notice=' + encodeURIComponent(notice) : '')
  );
}

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

    // New accounts must verify their email before first login: send a
    // 6-digit code and redirect to the code-entry page.
    try {
      await issueVerificationCode(user);
    } catch (err) {
      console.error('Failed to send verification email:', err && err.message);
      return render(
        'We created your account but could not send the verification email. Please try resending the code.',
        500
      );
    }
    res.redirect(verifyRedirect(email, 'We sent a 6-digit verification code to your email.'));
  } catch (err) {
    next(err);
  }
});

// --- Email verification: enter the 6-digit code ---
router.get('/verify', (req, res) => {
  const email = (req.query.email || '').trim().toLowerCase();
  const user = email ? db.findUserByEmail.get(email) : null;
  if (user && user.email_verified) return res.redirect('/dashboard');
  res.render('verify', {
    title: 'Verify your email',
    email,
    error: null,
    notice: req.query.notice || null,
  });
});

router.post('/verify', verifyLimiter, async (req, res, next) => {
  try {
    const email = (req.body.email || '').trim().toLowerCase();
    const code = (req.body.code || '').trim();
    const fail = (error, status = 400) =>
      res.status(status).render('verify', { title: 'Verify your email', email, error, notice: null });

    const user = db.findUserByEmail.get(email);
    if (!user) return fail('Invalid or expired code.');
    if (user.email_verified) return res.redirect('/dashboard');
    if (!user.verify_code_hash || codeExpired(user))
      return fail('That code has expired. Please request a new one.');

    const a = Buffer.from(hashCode(code), 'utf8');
    const b = Buffer.from(user.verify_code_hash, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b))
      return fail('Invalid code. Please check and try again.');

    db.setEmailVerified.run(user.id);
    const fresh = db.findUserById.get(user.id);
    req.login(fresh, (err) => (err ? next(err) : res.redirect('/dashboard')));
  } catch (err) {
    next(err);
  }
});

router.post('/verify/resend', resendLimiter, async (req, res, next) => {
  try {
    const email = (req.body.email || '').trim().toLowerCase();
    const user = db.findUserByEmail.get(email);
    // Always redirect the same way so we don't reveal which emails exist.
    const done = (notice) => res.redirect(verifyRedirect(email, notice));
    if (!user || user.email_verified) return done('If that email needs verification, a new code was sent.');
    await issueVerificationCode(user);
    return done('A new verification code was sent to your email.');
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

    // Email not verified yet? Send a fresh code and route to verification
    // instead of logging in.
    if (!user.email_verified) {
      try {
        await issueVerificationCode(user);
      } catch (err) {
        console.error('Failed to send verification email:', err && err.message);
      }
      return res.redirect(
        verifyRedirect(email, 'Please verify your email first — we sent you a new code.')
      );
    }

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
