// Passport configuration: session serialization + optional Google OAuth 2.0.
// The Google strategy is registered ONLY when GOOGLE_CLIENT_ID and
// GOOGLE_CLIENT_SECRET are configured; otherwise the Google buttons in the UI
// render a friendly "not configured" notice instead of crashing.
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const config = require('../config');
const db = require('../db');

passport.serializeUser((user, done) => done(null, user.id));

passport.deserializeUser((id, done) => {
  try {
    const user = db.findUserById.get(id);
    done(null, user || false);
  } catch (err) {
    done(err);
  }
});

if (config.google.configured) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: config.google.clientId,
        clientSecret: config.google.clientSecret,
        callbackURL: config.google.callbackUrl,
      },
      (accessToken, refreshToken, profile, done) => {
        try {
          const email =
            profile.emails && profile.emails[0] && profile.emails[0].value;
          const name = profile.displayName || email;
          if (!email) return done(new Error('Google did not provide an email address.'));

          // 1) Already linked to this Google account? Log straight in.
          let user = db.findUserByGoogleId.get(profile.id);
          if (user) return done(null, user);

          // 2) Account linking: same email already registered with a password?
          //    Link the Google ID to the existing account instead of creating a duplicate.
          user = db.findUserByEmail.get(email.toLowerCase());
          if (user) {
            db.linkGoogle.run(profile.id, user.id);
            return done(null, db.findUserById.get(user.id));
          }

          // 3) Brand-new user via Google.
          const info = db.createUser.run({
            email: email.toLowerCase(),
            password_hash: null,
            google_id: profile.id,
            name,
          });
          return done(null, db.findUserById.get(info.lastInsertRowid));
        } catch (err) {
          return done(err);
        }
      }
    )
  );
}

module.exports = passport;
