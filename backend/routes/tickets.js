// backend/routes/tickets.js
// Full CRUD + audit log + comments + subtasks + watchers

const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { getDb } = require('../database');

// Helper: write an audit log entry
function logAudit(db, ticket_id, changed_by, action, field_name, old_value, new_value, note) {
    db.run(
        'INSERT INTO ticket_audit_log (ticket_id, changed_by, action, field_name, old_value, new_value, note) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [ticket_id, changed_by, action, field_name || null, old_value || null, new_value || null, note || null]
    );
}

// GET /api/tickets
router.get('/', (req, res) => {
    const { project_id, sprint_id, status, assignee } = req.query;
    const db = getDb();

    let query = `
    SELECT t.*,
           u1.full_name as assignee_name,
           u2.full_name as reporter_name,
           (SELECT COUNT(*) FROM comments c WHERE c.ticket_id = t.id) as comment_count,
           (SELECT COUNT(*) FROM tickets sub WHERE sub.parent_id = t.id) as subtask_count
    FROM tickets t
    LEFT JOIN users u1 ON u1.initials = t.assignee_initials
    LEFT JOIN users u2 ON u2.initials = t.reporter_initials
    WHERE t.parent_id IS NULL
  `;
    const params = [];

    if (project_id) { query += ' AND t.project_id = ?'; params.push(project_id); }
    if (sprint_id === 'null' || sprint_id === 'backlog') {
        query += ' AND t.sprint_id IS NULL';
    } else if (sprint_id) {
        query += ' AND t.sprint_id = ?'; params.push(sprint_id);
    }
    if (status) { query += ' AND t.status = ?'; params.push(status); }
    if (assignee) { query += ' AND t.assignee_initials = ?'; params.push(assignee); }

    query += ' ORDER BY t.is_escalated DESC, t.updated_at DESC';

    res.json(params.length ? db.all(query, params) : db.all(query));
});

// GET /api/tickets/notifications — all watched incidents for current user
router.get('/notifications', (req, res) => {
    const db = getDb();
    const rows = db.all(`
        SELECT t.id, t.title, t.status, t.priority, t.is_escalated,
               (SELECT note FROM ticket_audit_log
                WHERE ticket_id = t.id ORDER BY id DESC LIMIT 1) AS latest_note,
               (SELECT timestamp FROM ticket_audit_log
                WHERE ticket_id = t.id ORDER BY id DESC LIMIT 1) AS latest_at
        FROM tickets t
        JOIN ticket_watchers tw ON tw.ticket_id = t.id
        WHERE tw.user_initials = ?
        ORDER BY latest_at DESC
    `, [req.user.initials]);
    res.json(rows);
});

// GET /api/tickets/:id
router.get('/:id', (req, res) => {
    const db = getDb();
    const ticket = db.get(`
    SELECT t.*,
           u1.full_name as assignee_name,
           u2.full_name as reporter_name,
           s.name as sprint_name,
           p.name as project_name,
           p.key as project_key
    FROM tickets t
    LEFT JOIN users u1 ON u1.initials = t.assignee_initials
    LEFT JOIN users u2 ON u2.initials = t.reporter_initials
    LEFT JOIN sprints s ON s.id = t.sprint_id
    LEFT JOIN projects p ON p.id = t.project_id
    WHERE t.id = ?
  `, [req.params.id]);

    if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });

    ticket.watchers = db.all(`
    SELECT tw.user_initials, u.full_name
    FROM ticket_watchers tw
    JOIN users u ON u.initials = tw.user_initials
    WHERE tw.ticket_id = ?
  `, [req.params.id]);

    res.json(ticket);
});

// POST /api/tickets
router.post('/',
    [
        body('title').trim().notEmpty().withMessage('Title is required'),
        body('project_id').notEmpty(),
    ],
    (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const { project_id, sprint_id, parent_id, title, description, status, priority,
            type, story_points, assignee_initials, assignee_name, labels, due_date,
            business_impact, next_step } = req.body;
        // Support free-text assignee_name from the simplified form
        const resolvedAssignee = assignee_initials || assignee_name || null;
        const db = getDb();

        const project = db.get('SELECT * FROM projects WHERE id = ?', [project_id]);
        if (!project) return res.status(404).json({ error: 'Project not found.' });

        const ticketId = `${project.key}-${project.ticket_counter}`;
        db.run('UPDATE projects SET ticket_counter = ticket_counter + 1 WHERE id = ?', [project_id]);

        const resolvedStatus = status || 'backlog';
        db.run(
            `INSERT INTO tickets (id, project_id, sprint_id, parent_id, title, description, status, priority,
                            type, story_points, assignee_initials, reporter_initials, labels, due_date, business_impact, next_step)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [ticketId, project_id, sprint_id || null, parent_id || null, title, description || '',
                resolvedStatus, priority || 'medium', type || 'task', story_points || null,
                resolvedAssignee, req.user.initials, labels || '', due_date || null,
                business_impact || null, next_step || null]
        );

        logAudit(db, ticketId, req.user.initials, 'created', null, null, null,
            `Ticket created — Status: ${resolvedStatus}, Priority: ${priority || 'medium'}, Type: ${type || 'task'}`);

        const ticket = db.get('SELECT * FROM tickets WHERE id = ?', [ticketId]);
        res.status(201).json(ticket);
    }
);

// PUT /api/tickets/:id
router.put('/:id', (req, res) => {
    const db = getDb();
    const ticket = db.get('SELECT * FROM tickets WHERE id = ?', [req.params.id]);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });

    const tracked = {
        status: { label: 'Status changed', action: 'status_changed' },
        priority: { label: 'Priority changed', action: 'priority_changed' },
        assignee_initials: { label: 'Assignee changed', action: 'assignee_changed' },
        sprint_id: { label: 'Sprint changed', action: 'sprint_changed' },
        story_points: { label: 'Story points changed', action: 'story_points_changed' },
        due_date: { label: 'Due date changed', action: 'due_date_set' },
        labels: { label: 'Labels changed', action: 'label_changed' },
        is_escalated: { label: 'Escalation changed', action: null },
        title: { label: 'Title changed', action: 'title_changed' },
        description: { label: 'Description changed', action: 'description_changed' },
        business_impact: { label: 'Business impact changed', action: 'business_impact_changed' },
        next_step: { label: 'Next step changed', action: 'next_step_changed' },
    };

    const fields = Object.keys(tracked);
    const updates = {};
    for (const field of fields) {
        if (req.body[field] !== undefined) updates[field] = req.body[field];
    }

    if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'No fields provided to update.' });
    }

    for (const [field, newVal] of Object.entries(updates)) {
        const oldVal = ticket[field];
        if (String(oldVal) !== String(newVal) && tracked[field]) {
            let action = tracked[field].action;
            if (field === 'is_escalated') {
                action = newVal == 1 ? 'escalated' : 'de_escalated';
            }
            logAudit(db, ticket.id, req.user.initials, action, field,
                String(oldVal ?? ''), String(newVal ?? ''),
                `${tracked[field].label}: "${oldVal}" → "${newVal}"`);
        }
    }

    const setClauses = Object.keys(updates).map(f => `${f} = ?`).join(', ');
    const values = [...Object.values(updates), ticket.id];
    db.run(`UPDATE tickets SET ${setClauses}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, values);

    const updated = db.get('SELECT * FROM tickets WHERE id = ?', [ticket.id]);
    res.json(updated);
});

// DELETE /api/tickets/:id
router.delete('/:id', (req, res) => {
    const db = getDb();
    const ticket = db.get('SELECT * FROM tickets WHERE id = ?', [req.params.id]);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });

    logAudit(db, ticket.id, req.user.initials, 'deleted', null, null, null, `Ticket deleted by ${req.user.full_name}`);
    db.run('DELETE FROM tickets WHERE id = ?', [req.params.id]);
    res.json({ message: 'Ticket deleted.' });
});

// ─── AUDIT LOG ────────────────────────────────────────────────────────────────

router.get('/:id/audit', (req, res) => {
    const db = getDb();
    const logs = db.all(`
    SELECT l.*, u.full_name as changed_by_name
    FROM ticket_audit_log l
    LEFT JOIN users u ON u.initials = l.changed_by
    WHERE l.ticket_id = ?
    ORDER BY l.timestamp ASC
  `, [req.params.id]);
    res.json(logs);
});

// ─── COMMENTS ─────────────────────────────────────────────────────────────────

router.get('/:id/comments', (req, res) => {
    const db = getDb();
    const comments = db.all(`
    SELECT c.*, u.full_name as author_name
    FROM comments c
    LEFT JOIN users u ON u.initials = c.author_initials
    WHERE c.ticket_id = ?
    ORDER BY c.created_at ASC
  `, [req.params.id]);
    res.json(comments);
});

router.post('/:id/comments',
    [body('content').trim().notEmpty()],
    (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const db = getDb();
        if (!db.get('SELECT id FROM tickets WHERE id = ?', [req.params.id])) {
            return res.status(404).json({ error: 'Ticket not found.' });
        }

        db.run(
            'INSERT INTO comments (ticket_id, author_initials, content) VALUES (?, ?, ?)',
            [req.params.id, req.user.initials, req.body.content]
        );

        logAudit(db, req.params.id, req.user.initials, 'commented', null, null, null,
            `Commented: "${req.body.content.slice(0, 80)}${req.body.content.length > 80 ? '…' : ''}"`);

        db.run('UPDATE tickets SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [req.params.id]);

        const comment = db.get(`
      SELECT c.*, u.full_name as author_name FROM comments c
      LEFT JOIN users u ON u.initials = c.author_initials
      WHERE c.id = (SELECT MAX(id) FROM comments WHERE ticket_id = ?)
    `, [req.params.id]);

        res.status(201).json(comment);
    }
);

// ─── SUBTASKS ─────────────────────────────────────────────────────────────────

router.get('/:id/subtasks', (req, res) => {
    const db = getDb();
    const subtasks = db.all(`
    SELECT t.*, u.full_name as assignee_name
    FROM tickets t
    LEFT JOIN users u ON u.initials = t.assignee_initials
    WHERE t.parent_id = ?
    ORDER BY t.created_at ASC
  `, [req.params.id]);
    res.json(subtasks);
});

router.post('/:id/subtasks',
    [body('title').trim().notEmpty()],
    (req, res) => {
        const db = getDb();
        const parent = db.get('SELECT * FROM tickets WHERE id = ?', [req.params.id]);
        if (!parent) return res.status(404).json({ error: 'Parent ticket not found.' });

        const project = db.get('SELECT * FROM projects WHERE id = ?', [parent.project_id]);
        const subtaskId = `${project.key}-${project.ticket_counter}`;
        db.run('UPDATE projects SET ticket_counter = ticket_counter + 1 WHERE id = ?', [parent.project_id]);

        db.run(
            `INSERT INTO tickets (id, project_id, sprint_id, parent_id, title, description, status, priority, type, reporter_initials)
       VALUES (?, ?, ?, ?, ?, ?, 'todo', 'medium', 'task', ?)`,
            [subtaskId, parent.project_id, parent.sprint_id, parent.id,
                req.body.title, req.body.description || '', req.user.initials]
        );

        logAudit(db, parent.id, req.user.initials, 'subtask_added', null, null, subtaskId,
            `Subtask added: ${subtaskId} — "${req.body.title}"`);

        const subtask = db.get('SELECT * FROM tickets WHERE id = ?', [subtaskId]);
        res.status(201).json(subtask);
    }
);

// ─── WATCHERS ─────────────────────────────────────────────────────────────────

router.post('/:id/watch', (req, res) => {
    const db = getDb();
    try {
        db.run('INSERT INTO ticket_watchers (ticket_id, user_initials) VALUES (?, ?)', [req.params.id, req.user.initials]);
        logAudit(db, req.params.id, req.user.initials, 'watcher_added', null, null, req.user.initials,
            `${req.user.full_name} is now watching this ticket`);
        res.json({ message: 'Now watching this ticket.' });
    } catch {
        res.status(409).json({ error: 'Already watching this ticket.' });
    }
});

router.delete('/:id/watch', (req, res) => {
    const db = getDb();
    db.run('DELETE FROM ticket_watchers WHERE ticket_id = ? AND user_initials = ?', [req.params.id, req.user.initials]);
    logAudit(db, req.params.id, req.user.initials, 'watcher_removed', null, null, req.user.initials,
        `${req.user.full_name} stopped watching this ticket`);
    res.json({ message: 'Unwatched ticket.' });
});

// ─── NOTIFICATIONS ─────────────────────────────────────────────────────────────

// GET /api/tickets/notifications — all watched incidents for current user
router.get('/notifications', (req, res) => {
    const db = getDb();
    const rows = db.all(`
        SELECT t.id, t.title, t.status, t.priority, t.is_escalated,
               (SELECT note FROM ticket_audit_log
                WHERE ticket_id = t.id ORDER BY id DESC LIMIT 1) AS latest_note,
               (SELECT timestamp FROM ticket_audit_log
                WHERE ticket_id = t.id ORDER BY id DESC LIMIT 1) AS latest_at
        FROM tickets t
        JOIN ticket_watchers tw ON tw.ticket_id = t.id
        WHERE tw.user_initials = ?
        ORDER BY latest_at DESC
    `, [req.user.initials]);
    res.json(rows);
});

module.exports = router;

