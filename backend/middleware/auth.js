// backend/middleware/auth.js
// JWT verification middleware

const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'ticketing-system-local-secret-2026';

function authMiddleware(req, res, next) {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No token provided. Please log in.' });
    }

    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded; // { initials, email, role, full_name }
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token. Please log in again.' });
    }
}

module.exports = { authMiddleware, JWT_SECRET };
