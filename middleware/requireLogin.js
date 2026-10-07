// Redirects anonymous visitors to /login, remembering where they were headed.
module.exports = function requireLogin(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
};
