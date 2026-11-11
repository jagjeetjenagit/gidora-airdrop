'use strict';
require('./src/lib/env').load();

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const config = require('./src/config/campaign');
const apiRouter = require('./src/routes/api');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.disable('x-powered-by');

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      styleSrcAttr: ["'unsafe-inline'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: false,
}));
app.use(compression());
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: process.env.NODE_ENV === 'production' ? '7d' : 0,
}));

app.locals.base = '/';
app.locals.isStatic = false;
app.locals.site = {
  brand: config.brand,
  demo: config.DEMO_MODE,
  links: config.links,
  year: new Date().getFullYear(),
};

const pages = [
  { path: '/', view: 'index', nav: 'claim', title: 'Claim Your GDR' },
  { path: '/leaderboard', view: 'leaderboard', nav: 'leaderboard', title: 'Airdrop Leaderboard' },
  { path: '/rewards', view: 'rewards', nav: 'rewards', title: 'Rewards & Referrals' },
];
for (const p of pages) {
  app.get(p.path, (req, res) => res.render(p.view, { nav: p.nav, title: p.title, campaign: config }));
}

app.use('/api', apiRouter);
app.use('/api', (req, res) => res.status(404).json({ error: 'not_found' }));

app.use((req, res) => res.status(404).render('404', { nav: '', title: 'Page not found', campaign: config }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  if (req.path.startsWith('/api')) return res.status(err.status || 500).json({ error: 'server_error', message: 'Something went wrong. Please try again.' });
  res.status(500).send('Something went wrong.');
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`GIDORA airdrop site → http://localhost:${PORT}${config.DEMO_MODE ? '  (DEMO MODE)' : ''}`);
  });
}

module.exports = app;
