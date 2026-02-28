// backend/routes/users.js

const express = require('express');
const router = express.Router();
const { getDb } = require('../database');

router.get('/', (req, res) => {
    const db = getDb();
    const users = db.all('SELECT id, full_name, initials, email, role FROM users ORDER BY full_name');
    res.json(users);
});

module.exports = router;
