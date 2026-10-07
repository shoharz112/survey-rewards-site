// CPX Research server-to-server postback endpoint.
//
// CPX calls:
//   GET /api/postback/cpx?user_id={user_id}&amount={amount}
//       &amount_local={amount_local}&trans_id={trans_id}
//       &subid_1={subid_1}&subid_2={subid_2}&secure_hash={secure_hash}
//
// Where:
//   user_id     - the ext_user_id we passed in the offerwall iframe (our user id)
//   amount      - publisher earnings for this conversion, in USD
//   amount_local- publisher earnings in the publisher's CPX dashboard currency
//   trans_id    - CPX Research transaction ID (unique per conversion)
//   secure_hash - md5("{user_id}-{app_secure_hash}") using the RAW user_id
//                 value exactly as received, and the app secure key from the
//                 CPX publisher dashboard (INFO tab, "app secure hash").
//
// SIGNATURE VERIFICATION (must match the dashboard's documented scheme):
//   secure_hash = md5( user_id + "-" + CPX_SECURE_KEY )
// The comparison uses crypto.timingSafeEqual to avoid timing attacks.
// Never log CPX_SECURE_KEY or any secret here.
//
// IDEMPOTENCY: each credited conversion is stored in the ledger with a unique
// ref_key built from CPX's trans_id. Replays of the same postback are
// acknowledged but ignored.
//
// POINTS: credited as Math.round(usdAmount * POINTS_PER_USD). We use `amount`
// (USD) as the source of truth; if it is missing we fall back to
// `amount_local` (which equals USD when the publisher dashboard currency is
// USD, the default).
//
// NOTE: this endpoint intentionally has no session — CPX calls it directly.
// Malformed input is 400 (CPX treats non-2xx as retryable, so only answer
// 5xx on genuine server failure).
const express = require('express');
const crypto = require('crypto');
const config = require('../config');
const db = require('../db');

const router = express.Router();

const md5 = (s) => crypto.createHash('md5').update(s, 'utf8').digest('hex');

router.get('/cpx', (req, res) => {
  try {
    const q = req.query;

    // --- Validate input (never crash on bad input) ---
    const rawUserId = String(q.user_id ?? '').trim();
    const user_id = parseInt(rawUserId, 10);
    const amount = parseFloat(q.amount);
    const amountLocal = parseFloat(q.amount_local);
    const transId = String(q.trans_id ?? '').trim();
    const secure_hash = String(q.secure_hash ?? '').trim().toLowerCase();

    if (!Number.isInteger(user_id) || user_id <= 0)
      return res.status(400).send('Bad request: invalid user_id');
    if (!transId)
      return res.status(400).send('Bad request: missing trans_id');
    if (!secure_hash)
      return res.status(400).send('Bad request: missing secure_hash');
    if (!config.cpx.secureKey) {
      console.error('CPX postback rejected: CPX_SECURE_KEY is not configured on this server.');
      return res.status(500).send('Server misconfigured');
    }

    // --- Verify signature: md5("{user_id}-{app_secure_hash}") ---
    // Uses the RAW user_id string exactly as CPX sent it.
    const expected = md5(`${rawUserId}-${config.cpx.secureKey}`);
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(secure_hash, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      console.warn(
        `CPX postback rejected: signature mismatch (user_id=${rawUserId}, trans_id=${transId})`
      );
      return res.status(400).send('Bad request: invalid secure_hash');
    }

    const user = db.findUserById.get(user_id);
    if (!user) {
      console.warn(`CPX postback for unknown user_id=${rawUserId} — ignored.`);
      return res.status(400).send('Bad request: unknown user');
    }

    // --- Compute points (USD earnings -> site points) ---
    const usd = Number.isFinite(amount) ? amount : amountLocal;
    if (!Number.isFinite(usd) || usd < 0)
      return res.status(400).send('Bad request: invalid amount');
    const points = Math.round(usd * config.pointsPerUsd);

    // --- Idempotent credit keyed on CPX's transaction id ---
    const refKey = `cpx:trans:${transId}`;
    const ledgerId = db.creditPoints(
      user_id,
      points,
      `CPX survey completion (trans ${transId}, $${usd})`,
      refKey
    );

    if (ledgerId === null) {
      console.log(`CPX postback duplicate ignored (trans_id=${transId}).`);
      return res.status(200).send('duplicate');
    }

    console.log(
      `CPX postback credited: user_id=${user_id} +${points} pts ` +
      `(trans ${transId}, usd ${usd})`
    );
    return res.status(200).send('ok');
  } catch (err) {
    // Never crash, never leak internals.
    console.error('CPX postback error:', err && err.message);
    return res.status(400).send('Bad request');
  }
});

module.exports = router;
