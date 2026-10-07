// Central configuration. Every secret comes from environment variables —
// nothing sensitive is hardcoded. See .env.example for documentation.
require('dotenv').config();

const isProd = process.env.NODE_ENV === 'production';

function requiredInProd(name) {
  const v = process.env[name];
  if (!v && isProd) {
    console.error(`FATAL: ${name} must be set when NODE_ENV=production.`);
    process.exit(1);
  }
  return v;
}

// SESSION_SECRET is mandatory in production; in dev we fall back to a loud,
// insecure default so `npm start` works out of the box for evaluation.
let sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret && isProd) requiredInProd('SESSION_SECRET');
if (!sessionSecret) {
  sessionSecret = 'dev-only-insecure-secret-change-me-before-production';
  console.warn(
    'WARNING: SESSION_SECRET is not set — using an insecure dev default. ' +
    'Set a real value in .env before exposing this app.'
  );
}

const port = parseInt(process.env.PORT || '3000', 10);

const config = {
  env: process.env.NODE_ENV || 'development',
  isProd,
  port,
  baseUrl: (process.env.BASE_URL || `http://localhost:${port}`).replace(/\/$/, ''),
  sessionSecret,
  dbPath: process.env.DB_PATH || './data/app.db',
  siteName: process.env.SITE_NAME || 'SurveyRewards',

  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    callbackUrl: process.env.GOOGLE_CALLBACK_URL || '',
  },

  cpx: {
    appId: process.env.CPX_APP_ID || '',
    offerwallUrl: (process.env.CPX_OFFERWALL_URL || 'https://offers.cpx-research.com/index.php').replace(/\/$/, ''),
    secureKey: process.env.CPX_SECURE_KEY || '',
  },

  pointsPerUsd: parseFloat(process.env.POINTS_PER_USD || '100'),
};

config.google.callbackUrl =
  config.google.callbackUrl || `${config.baseUrl}/auth/google/callback`;
config.google.configured = Boolean(config.google.clientId && config.google.clientSecret);

if (!config.google.configured) {
  console.warn('NOTICE: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set — the Google button will show a setup notice.');
}
if (!config.cpx.appId) {
  console.warn('NOTICE: CPX_APP_ID not set — the Earn page will show the offerwall setup guide instead of the iframe.');
}

module.exports = config;
