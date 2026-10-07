// Entry point. Boots Express, sessions, Passport, routes, then listens.
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const path = require('path');

const config = require('./config');
require('./db'); // auto-creates SQLite tables on boot
const passport = require('./lib/passport');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
// Trust the first proxy (Render/Railway/Heroku) so secure cookies work behind it.
app.set('trust proxy', 1);

// Helmet with CSP disabled: the Earn page embeds the CPX offerwall iframe from
// an external origin, which a default CSP would block. If you later lock this
// down, use frame-src to allowlist your offerwall provider instead.
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Sessions are persisted in SQLite (not MemoryStore) so logins survive
// process restarts. Note: on hosts with ephemeral disks (e.g. Render free
// tier) the DB file itself is wiped on redeploy — a persistent disk fixes
// that (see README).
const SQLiteStore = require('connect-sqlite3')(session);
app.use(
  session({
    name: 'srs.sid',
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    store: new SQLiteStore({
      db: 'sessions.db',
      dir: require('path').dirname(require('path').resolve(config.dbPath)),
    }),
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.isProd, // requires HTTPS in production
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    },
  })
);
app.use(passport.initialize());
app.use(passport.session());

// Shared template locals — must run AFTER passport.session() so req.user is
// populated; otherwise the nav header never shows the logged-in state.
app.use((req, res, next) => {
  res.locals.currentUser = req.user || null;
  res.locals.siteName = config.siteName;
  next();
});

app.use('/auth', require('./routes/auth'));
app.use('/', require('./routes/pages'));
app.use('/api/postback', require('./routes/postback'));

app.get('/healthz', (req, res) => res.send('ok'));

// 404 handler
app.use((req, res) => res.status(404).render('404', { title: 'Not found' }));

// Error handler — never leak stack traces or secrets to the client.
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err && err.message);
  res.status(500).render('500', { title: 'Something went wrong' });
});

app.listen(config.port, () => {
  console.log(`[${config.siteName}] listening on ${config.baseUrl} (env=${config.env})`);
});
