// backend/routes/sprints.js

const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { getDb } = require('../database');

// GET /api/sprints?project_id=
router.get('/', (req, res) => {
    const { project_id } = req.query;
    const db = getDb();

    const sprints = project_id
        ? db.all('SELECT * FROM sprints WHERE project_id = ? ORDER BY created_at DESC', [project_id])
        : db.all('SELECT * FROM sprints ORDER BY created_at DESC');

    res.json(sprints);
});

// POST /api/sprints
router.post('/',
    [
        body('name').trim().notEmpty(),
        body('project_id').notEmpty(),
    ],
    (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const { project_id, name, goal, start_date, end_date } = req.body;
        const db = getDb();

        db.run(
            'INSERT INTO sprints (project_id, name, goal, status, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?)',
            [project_id, name, goal || '', 'planning', start_date || null, end_date || null]
        );

        const sprint = db.get('SELECT * FROM sprints WHERE id = (SELECT MAX(id) FROM sprints WHERE project_id = ?)', [project_id]);
        res.status(201).json(sprint);
    }
);

// PUT /api/sprints/:id
router.put('/:id', (req, res) => {
    const db = getDb();
    const sprint = db.get('SELECT * FROM sprints WHERE id = ?', [req.params.id]);
    if (!sprint) return res.status(404).json({ error: 'Sprint not found.' });

    const { name, goal, status, start_date, end_date } = req.body;

    if (status === 'active') {
        db.run(
            "UPDATE sprints SET status = 'completed' WHERE project_id = ? AND status = 'active' AND id != ?",
            [sprint.project_id, req.params.id]
        );
    }

    db.run(
        'UPDATE sprints SET name=?, goal=?, status=?, start_date=?, end_date=? WHERE id=?',
        [
            name || sprint.name,
            goal !== undefined ? goal : sprint.goal,
            status || sprint.status,
            start_date || sprint.start_date,
            end_date || sprint.end_date,
            req.params.id
        ]
    );

    const updated = db.get('SELECT * FROM sprints WHERE id = ?', [req.params.id]);
    res.json(updated);
});

// DELETE /api/sprints/:id
router.delete('/:id', (req, res) => {
    const db = getDb();
    db.run("UPDATE tickets SET sprint_id = NULL, status = 'backlog' WHERE sprint_id = ?", [req.params.id]);
    db.run('DELETE FROM sprints WHERE id = ?', [req.params.id]);
    res.json({ message: 'Sprint deleted. Tickets moved back to backlog.' });
});

module.exports = router;
