// backend/routes/dashboard.js

const express = require('express');
const router = express.Router();
const { getDb } = require('../database');

router.get('/stats', (req, res) => {
  const db = getDb();

  const byStatus = db.all('SELECT status, COUNT(*) as count FROM tickets GROUP BY status');
  const byPriority = db.all('SELECT priority, COUNT(*) as count FROM tickets GROUP BY priority');
  const byType = db.all('SELECT type, COUNT(*) as count FROM tickets GROUP BY type');
  const escalated = db.get('SELECT COUNT(*) as count FROM tickets WHERE is_escalated = 1');
  const overdue = db.get("SELECT COUNT(*) as count FROM tickets WHERE due_date IS NOT NULL AND due_date < date('now') AND status != 'done'");
  const byAssignee = db.all(`
    SELECT t.assignee_initials, u.full_name, COUNT(*) as ticket_count
    FROM tickets t
    LEFT JOIN users u ON u.initials = t.assignee_initials
    WHERE t.assignee_initials IS NOT NULL
    GROUP BY t.assignee_initials
    ORDER BY ticket_count DESC
  `);
  const recentActivity = db.all(`
    SELECT l.*, u.full_name as changed_by_name
    FROM ticket_audit_log l
    LEFT JOIN users u ON u.initials = l.changed_by
    ORDER BY l.timestamp DESC
    LIMIT 10
  `);

  res.json({ byStatus, byPriority, byType, escalated: escalated.count, overdue: overdue.count, byAssignee, recentActivity });
});

module.exports = router;
