// backend/routes/auth.js

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { getDb } = require('../database');
const { JWT_SECRET } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimiter');

// POST /api/auth/register
router.post('/register',
    authLimiter,
    [
        body('email').isEmail().normalizeEmail(),
        body('password').isLength({ min: 8 }),
        body('full_name').trim().notEmpty(),
    ],
    (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const { email, password, full_name } = req.body;
        const db = getDb();

        if (db.get('SELECT id FROM users WHERE email = ?', [email])) {
            return res.status(409).json({ error: 'Email already registered.' });
        }

        // Generate unique initials
        const parts = full_name.trim().split(' ');
        let initials = parts.map(p => p[0].toUpperCase()).join('').slice(0, 3);
        let uniqueInitials = initials;
        let counter = 1;
        while (db.get('SELECT id FROM users WHERE initials = ?', [uniqueInitials])) {
            uniqueInitials = initials + counter++;
        }

        const password_hash = bcrypt.hashSync(password, 12);
        db.run(
            'INSERT INTO users (full_name, initials, email, password_hash, role) VALUES (?, ?, ?, ?, ?)',
            [full_name.trim(), uniqueInitials, email, password_hash, 'member']
        );

        const user = db.get('SELECT id, full_name, initials, email, role FROM users WHERE email = ?', [email]);
        const token = jwt.sign({ initials: user.initials, email: user.email, role: user.role, full_name: user.full_name }, JWT_SECRET, { expiresIn: '8h' });

        res.status(201).json({ token, user });
    }
);

// POST /api/auth/login
router.post('/login',
    authLimiter,
    [
        body('email').isEmail().normalizeEmail(),
        body('password').notEmpty(),
    ],
    (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const { email, password } = req.body;
        const db = getDb();

        const user = db.get('SELECT * FROM users WHERE email = ?', [email]);
        if (!user || !bcrypt.compareSync(password, user.password_hash)) {
            return res.status(401).json({ error: 'Invalid email or password.' });
        }

        const token = jwt.sign(
            { initials: user.initials, email: user.email, role: user.role, full_name: user.full_name },
            JWT_SECRET,
            { expiresIn: '8h' }
        );

        res.json({ token, user: { id: user.id, full_name: user.full_name, initials: user.initials, email: user.email, role: user.role } });
    }
);

// GET /api/auth/me
router.get('/me', require('../middleware/auth').authMiddleware, (req, res) => {
    const db = getDb();
    const user = db.get('SELECT id, full_name, initials, email, role, created_at FROM users WHERE initials = ?', [req.user.initials]);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json(user);
});

module.exports = router;
