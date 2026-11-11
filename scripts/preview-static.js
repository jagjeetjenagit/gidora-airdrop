'use strict';
// Serve dist/ under BASE_PATH to preview the GitHub Pages build locally.
const path = require('path');
const express = require('express');
let base = process.env.BASE_PATH || '/';
if (!base.endsWith('/')) base += '/';
const app = express();
const dist = path.join(__dirname, '..', 'dist');
app.use(base, express.static(dist));
app.use((req, res) => res.status(404).sendFile(path.join(dist, '404.html')));
const port = Number(process.env.PORT) || 4000;
app.listen(port, () => console.log(`Static preview → http://localhost:${port}${base}`));
