// backend/routes/projects.js

const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { getDb } = require('../database');

// GET /api/projects
router.get('/', (req, res) => {
    const db = getDb();
    const projects = db.all(`
    SELECT p.*, 
           COUNT(t.id) as ticket_count,
           u.full_name as lead_name
    FROM projects p
    LEFT JOIN tickets t ON t.project_id = p.id
    LEFT JOIN users u ON u.initials = p.lead_initials
    GROUP BY p.id
    ORDER BY p.created_at DESC
  `);
    res.json(projects);
});

// GET /api/projects/:id
router.get('/:id', (req, res) => {
    const db = getDb();
    const project = db.get('SELECT * FROM projects WHERE id = ?', [req.params.id]);
    if (!project) return res.status(404).json({ error: 'Project not found.' });
    res.json(project);
});

// POST /api/projects
router.post('/',
    [
        body('name').trim().notEmpty().withMessage('Project name is required'),
        body('key').trim().isLength({ min: 2, max: 5 }).withMessage('Key must be 2-5 characters'),
    ],
    (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const { name, description, key, lead_initials } = req.body;
        const db = getDb();
        const upperKey = key.toUpperCase();

        if (db.get('SELECT id FROM projects WHERE key = ?', [upperKey])) {
            return res.status(409).json({ error: `Project key "${upperKey}" already exists.` });
        }

        const projectId = 'project-' + Date.now();
        db.run(
            'INSERT INTO projects (id, name, description, key, lead_initials) VALUES (?, ?, ?, ?, ?)',
            [projectId, name, description || '', upperKey, lead_initials || req.user.initials]
        );

        const project = db.get('SELECT * FROM projects WHERE id = ?', [projectId]);
        res.status(201).json(project);
    }
);

// DELETE /api/projects/:id
router.delete('/:id', (req, res) => {
    const db = getDb();
    const project = db.get('SELECT * FROM projects WHERE id = ?', [req.params.id]);
    if (!project) return res.status(404).json({ error: 'Project not found.' });

    if (req.user.role !== 'admin' && project.lead_initials !== req.user.initials) {
        return res.status(403).json({ error: 'Only the project lead or an admin can delete this project.' });
    }

    db.run('DELETE FROM projects WHERE id = ?', [req.params.id]);
    res.json({ message: 'Project deleted successfully.' });
});

module.exports = router;
