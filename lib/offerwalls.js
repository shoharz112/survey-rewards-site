// Offerwall provider registry.
//
// Each provider gets a builder that returns { id, name, iframeUrl } for a
// user, or null when that provider isn't configured (missing credentials).
// The Earn page renders one tab per configured wall.
//
// To add a provider:
//   1. Add its credentials to config.js + .env.example (like config.cpx).
//   2. Add a builder below following the cpxWall pattern.
//   3. Add its postback route (see routes/postback.js) — each provider signs
//      postbacks differently, so verification stays provider-specific.
const crypto = require('crypto');
const config = require('../config');

function cpxWall(user) {
  if (!config.cpx.appId) return null;
  const extUserId = String(user.id);
  const params =
    `?app_id=${encodeURIComponent(config.cpx.appId)}` +
    `&ext_user_id=${encodeURIComponent(extUserId)}`;
  const secureParam = config.cpx.secureKey
    ? `&secure_hash=${crypto
        .createHash('md5')
        .update(`${extUserId}-${config.cpx.secureKey}`, 'utf8')
        .digest('hex')}`
    : '';
  const identityParam =
    `&username=${encodeURIComponent(user.name || '')}` +
    `&email=${encodeURIComponent(user.email || '')}`;
  return {
    id: 'cpx',
    name: 'CPX Research',
    iframeUrl: `${config.cpx.offerwallUrl}${params}${secureParam}${identityParam}`,
  };
}

// --- Future providers plug in here (return null until configured) ---
// function bitlabsWall(user) { ... }
// function theoremreachWall(user) { ... }

const builders = [cpxWall];

function getWalls(user) {
  return builders.map((build) => build(user)).filter(Boolean);
}

module.exports = { getWalls };
