// backend/server.js
// Main Express application entry point

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');
const { initializeDatabase } = require('./database');
const { authMiddleware } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Security Middleware ────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false })); // CSP off so CDN scripts load
app.use(cors({ origin: `http://localhost:${PORT}`, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Serve Static Frontend Files ────────────────────────────────────────────
// Serve the parent TICKETING SYSTEM folder as static root
app.use(express.static(path.join(__dirname, '..')));

// ─── API Routes ─────────────────────────────────────────────────────────────
// Public routes (no auth)
app.use('/api/auth', require('./routes/auth'));

// Protected routes (require valid JWT)
app.use('/api/projects', authMiddleware, require('./routes/projects'));
app.use('/api/sprints', authMiddleware, require('./routes/sprints'));
app.use('/api/tickets', authMiddleware, require('./routes/tickets'));
app.use('/api/users', authMiddleware, require('./routes/users'));
app.use('/api/events', authMiddleware, require('./routes/events'));
app.use('/api/dashboard', authMiddleware, require('./routes/dashboard'));

// ─── Catch-all: serve login page for unknown routes ─────────────────────────
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'login.html'));
});

// ─── Start Server ───────────────────────────────────────────────────────────
initializeDatabase();
app.listen(PORT, () => {
    console.log('');
    console.log('╔════════════════════════════════════════════╗');
    console.log('║       Ticketing System — Local Server      ║');
    console.log(`║   Running at: http://localhost:${PORT}         ║`);
    console.log('╚════════════════════════════════════════════╝');
    console.log('');
    console.log('  Default accounts:');
    console.log('  admin@local.com   / admin1234  (admin)');
    console.log('  jd@local.com      / password1  (John Doe)');
    console.log('  aj@local.com      / password2  (Alice Johnson)');
    console.log('  rs@local.com      / password3  (Robert Smith)');
    console.log('  mb@local.com      / password4  (Maria Brown)');
    console.log('');
});
