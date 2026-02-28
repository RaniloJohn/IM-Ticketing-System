// backend/routes/events.js

const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { getDb } = require('../database');

router.get('/', (req, res) => {
    const db = getDb();
    const events = db.all(`
    SELECT e.*, u.full_name as creator_name
    FROM events e
    LEFT JOIN users u ON u.initials = e.created_by
    ORDER BY e.event_date ASC, e.event_time ASC
  `);
    res.json(events);
});

router.post('/',
    [
        body('title').trim().notEmpty().withMessage('Event title is required'),
        body('event_date').notEmpty().withMessage('Event date is required'),
    ],
    (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const { title, description, event_date, event_time, event_type } = req.body;
        const db = getDb();

        db.run(
            'INSERT INTO events (title, description, event_date, event_time, event_type, created_by) VALUES (?, ?, ?, ?, ?, ?)',
            [title, description || '', event_date, event_time || null, event_type || 'other', req.user.initials]
        );

        const event = db.get('SELECT * FROM events WHERE id = (SELECT MAX(id) FROM events)');
        res.status(201).json(event);
    }
);

router.delete('/:id', (req, res) => {
    const db = getDb();
    const event = db.get('SELECT * FROM events WHERE id = ?', [req.params.id]);
    if (!event) return res.status(404).json({ error: 'Event not found.' });

    if (event.created_by !== req.user.initials && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'You can only delete your own events.' });
    }

    db.run('DELETE FROM events WHERE id = ?', [req.params.id]);
    res.json({ message: 'Event deleted.' });
});

module.exports = router;
