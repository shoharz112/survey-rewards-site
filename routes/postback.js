// CPX Research-style server-to-server postback endpoint.
//
// CPX calls:  GET /api/postback/cpx?user_id=..&amount_local=..&amount_usd=..
//             &secure_hash=..&type=..&offer_id=..&subid=..&subid_2=..&ip_click=..
//
// SIGNATURE SCHEME (must match what you configure in the CPX publisher dashboard):
//   secure_hash = md5( user_id + "|" + amount_local + "|" + amount_usd + "|" +
//                      type + "|" + offer_id + "|" + subid + "|" + subid_2 + "|" +
//                      ip_click + "|" + CPX_SECURE_KEY )
// using the RAW query-string values exactly as received. The comparison uses
// crypto.timingSafeEqual to avoid timing attacks.
//
// IDEMPOTENCY: each processed credit is stored in the ledger with a unique
// ref_key built from user_id + offer_id + type + amount_local. Replays of the
// same postback are acknowledged but ignored.
//
// NOTE: this endpoint intentionally has no session — CPX calls it directly.
// Never log CPX_SECURE_KEY or any secret here.
const express = require('express');
const crypto = require('crypto');
const config = require('../config');
const db = require('../db');

const router = express.Router();

const md5 = (s) => crypto.createHash('md5').update(s, 'utf8').digest('hex');
const VALID_TYPES = ['Complete', 'Out', 'Bonus'];

router.get('/cpx', (req, res) => {
  try {
    const q = req.query;

    // --- Validate input (never crash on bad input) ---
    const user_id = parseInt(q.user_id, 10);
    const amount_local = parseFloat(q.amount_local);
    const type = (q.type || '').trim();
    const secure_hash = (q.secure_hash || '').trim().toLowerCase();

    if (!Number.isInteger(user_id) || user_id <= 0)
      return res.status(400).send('Bad request: invalid user_id');
    if (!Number.isFinite(amount_local) || amount_local < 0)
      return res.status(400).send('Bad request: invalid amount_local');
    if (!VALID_TYPES.includes(type))
      return res.status(400).send('Bad request: invalid type');
    if (!secure_hash)
      return res.status(400).send('Bad request: missing secure_hash');
    if (!config.cpx.secureKey) {
      console.error('CPX postback rejected: CPX_SECURE_KEY is not configured on this server.');
      return res.status(500).send('Server misconfigured');
    }

    // --- Verify signature (timing-safe) ---
    const payload = [
      String(q.user_id ?? ''),
      String(q.amount_local ?? ''),
      String(q.amount_usd ?? ''),
      type,
      String(q.offer_id ?? ''),
      String(q.subid ?? ''),
      String(q.subid_2 ?? ''),
      String(q.ip_click ?? ''),
    ].join('|') + '|' + config.cpx.secureKey;

    const expected = md5(payload);
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(secure_hash, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      console.warn(
        `CPX postback rejected: signature mismatch (user_id=${user_id}, offer_id=${q.offer_id || 'n/a'})`
      );
      return res.status(400).send('Bad request: invalid secure_hash');
    }

    const user = db.findUserById.get(user_id);
    if (!user) {
      console.warn(`CPX postback for unknown user_id=${user_id} — ignored.`);
      return res.status(400).send('Bad request: unknown user');
    }

    // Screened-out users earn nothing; log and acknowledge.
    if (type === 'Out') {
      console.log(`CPX postback: user_id=${user_id} screened out of offer ${q.offer_id || 'n/a'} — no credit.`);
      return res.status(200).send('ok');
    }

    // amount_local is denominated in site points (whole numbers).
    const points = Math.round(amount_local);
    const refKey = `cpx:${user_id}:${q.offer_id || 'noid'}:${type}:${q.amount_local}`;
    const ledgerId = db.creditPoints(
      user_id,
      points,
      `CPX survey ${type} (offer ${q.offer_id || 'n/a'})`,
      refKey
    );

    if (ledgerId === null) {
      console.log(`CPX postback duplicate ignored (ref_key=${refKey}).`);
      return res.status(200).send('duplicate');
    }

    console.log(
      `CPX postback credited: user_id=${user_id} +${points} pts ` +
      `(offer ${q.offer_id || 'n/a'}, type ${type}, usd ${q.amount_usd || 'n/a'})`
    );
    return res.status(200).send('ok');
  } catch (err) {
    // Never crash, never leak internals — CPX will retry on non-2xx,
    // so only 5xx on genuine server failure; malformed input is 400.
    console.error('CPX postback error:', err && err.message);
    return res.status(400).send('Bad request');
  }
});

module.exports = router;
