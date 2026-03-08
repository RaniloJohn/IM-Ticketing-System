// backend/database.js
// SQLite schema initialization and seed data
// Uses node-sqlite3-wasm (pure WASM, no Python/node-gyp needed)

const { Database } = require('node-sqlite3-wasm');
const bcrypt = require('bcryptjs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'ticketing.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    // Enable WAL mode and foreign keys
    db.run('PRAGMA journal_mode = WAL');
    db.run('PRAGMA foreign_keys = ON');
  }
  return db;
}

function initializeDatabase() {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      initials TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      key TEXT NOT NULL UNIQUE,
      lead_initials TEXT,
      ticket_counter INTEGER NOT NULL DEFAULT 101,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sprints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      goal TEXT,
      status TEXT NOT NULL DEFAULT 'planning',
      start_date DATE,
      end_date DATE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tickets (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      sprint_id INTEGER,
      parent_id TEXT,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'backlog',
      priority TEXT NOT NULL DEFAULT 'medium',
      type TEXT NOT NULL DEFAULT 'task',
      story_points INTEGER,
      assignee_initials TEXT,
      reporter_initials TEXT,
      labels TEXT DEFAULT '',
      due_date DATE,
      is_escalated INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (sprint_id) REFERENCES sprints(id) ON DELETE SET NULL,
      FOREIGN KEY (parent_id) REFERENCES tickets(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS ticket_watchers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id TEXT NOT NULL,
      user_initials TEXT NOT NULL,
      watched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(ticket_id, user_initials),
      FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id TEXT NOT NULL,
      author_initials TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ticket_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id TEXT NOT NULL,
      changed_by TEXT NOT NULL,
      action TEXT NOT NULL,
      field_name TEXT,
      old_value TEXT,
      new_value TEXT,
      note TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      event_date DATE NOT NULL,
      event_time TEXT,
      event_type TEXT NOT NULL DEFAULT 'other',
      created_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Safe migrations — add new columns if they don't exist yet
  const addColIfMissing = (col, def) => {
    try { db.run(`ALTER TABLE tickets ADD COLUMN ${col} ${def}`); } catch (_) { /* already exists */ }
  };
  addColIfMissing('business_impact', 'TEXT');
  addColIfMissing('next_step', 'TEXT');

  seedInitialData(db);
  console.log('[DB] Database initialized successfully.');
}

function seedInitialData(db) {
  const userCount = db.get('SELECT COUNT(*) as count FROM users');
  if (userCount.count > 0) return;

  console.log('[DB] Seeding initial data...');

  const hash = (pw) => bcrypt.hashSync(pw, 12);

  const seedUsers = [
    { full_name: 'Admin', initials: 'AD', email: 'admin@local.com', pw: 'admin1234', role: 'admin' },
    { full_name: 'John Doe', initials: 'JD', email: 'jd@local.com', pw: 'password1', role: 'member' },
    { full_name: 'Alice Johnson', initials: 'AJ', email: 'aj@local.com', pw: 'password2', role: 'member' },
    { full_name: 'Robert Smith', initials: 'RS', email: 'rs@local.com', pw: 'password3', role: 'member' },
    { full_name: 'Maria Brown', initials: 'MB', email: 'mb@local.com', pw: 'password4', role: 'member' },
  ];

  for (const u of seedUsers) {
    db.run(
      'INSERT INTO users (full_name, initials, email, password_hash, role) VALUES (?, ?, ?, ?, ?)',
      [u.full_name, u.initials, u.email, hash(u.pw), u.role]
    );
  }

  // Default project
  const projectId = 'project-default';
  db.run(
    'INSERT INTO projects (id, name, description, key, lead_initials, ticket_counter) VALUES (?, ?, ?, ?, ?, ?)',
    [projectId, 'Default Project', 'A sample project to get started', 'DP', 'JD', 101]
  );

  // Seed a sprint
  db.run(
    'INSERT INTO sprints (project_id, name, goal, status, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?)',
    [projectId, 'Sprint 1', 'Initial sprint to set up core features', 'active', '2026-02-28', '2026-03-14']
  );
  const sprint = db.get('SELECT id FROM sprints WHERE project_id = ? ORDER BY id DESC', [projectId]);
  const sprintId = sprint.id;

  // Sample tickets
  const sampleTickets = [
    { id: 'DP-101', sprint: sprintId, title: 'Network outage in Building A', desc: 'Complete network failure affecting all users in Building A. ISP notified.', status: 'new', priority: 'high', type: 'incident', sp: 5, assignee: 'JD', reporter: 'JD', labels: 'network,infrastructure' },
    { id: 'DP-102', sprint: sprintId, title: 'Email server unresponsive', desc: 'Exchange server not accepting connections since 08:00 AM. Multiple users affected.', status: 'active', priority: 'high', type: 'incident', sp: 3, assignee: 'AJ', reporter: 'JD', labels: 'email,server' },
    { id: 'DP-103', sprint: sprintId, title: 'VPN service degraded performance', desc: 'Remote users reporting slow VPN throughput. Under investigation.', status: 'active', priority: 'medium', type: 'problem', sp: 8, assignee: 'RS', reporter: 'JD', labels: 'vpn,network' },
    { id: 'DP-104', sprint: sprintId, title: 'Printer offline in HR department', desc: 'HP LaserJet in HR room 204 offline. Toner may need replacement.', status: 'new', priority: 'medium', type: 'service_request', sp: 2, assignee: 'MB', reporter: 'AJ', labels: 'hardware' },
    { id: 'DP-105', sprint: sprintId, title: 'Database backup failure', desc: 'Nightly backup job failed on prod DB. Storage capacity may be exceeded.', status: 'active', priority: 'high', type: 'incident', sp: 8, assignee: 'JD', reporter: 'RS', labels: 'database,backup' },
    { id: 'DP-106', sprint: null, title: 'SSL certificate renewal', desc: 'Renewed SSL certificate for main domain. Deployed and verified.', status: 'resolved', priority: 'low', type: 'change_request', sp: 2, assignee: 'AJ', reporter: 'JD', labels: 'security' },
    { id: 'DP-107', sprint: null, title: 'Firewall rule misconfiguration', desc: 'Incorrect firewall rule blocked internal traffic. Corrected and tested.', status: 'closed', priority: 'high', type: 'incident', sp: 5, assignee: 'RS', reporter: 'MB', labels: 'security,network' },
    { id: 'DP-108', sprint: null, title: 'Server room temperature alert', desc: 'HVAC readings above threshold. Facilities team engaged. Monitoring in progress.', status: 'new', priority: 'medium', type: 'problem', sp: 13, assignee: 'MB', reporter: 'JD', labels: 'infrastructure,hardware' },
  ];

  for (const t of sampleTickets) {
    db.run(
      `INSERT INTO tickets (id, project_id, sprint_id, title, description, status, priority, type, story_points, assignee_initials, reporter_initials, labels)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [t.id, projectId, t.sprint, t.title, t.desc, t.status, t.priority, t.type, t.sp, t.assignee, t.reporter, t.labels]
    );
    db.run(
      'INSERT INTO ticket_audit_log (ticket_id, changed_by, action, note) VALUES (?, ?, ?, ?)',
      [t.id, t.reporter, 'created', `Incident created — Status: ${t.status}, Priority: ${t.priority}, Type: ${t.type}`]
    );
  }

  db.run('UPDATE projects SET ticket_counter = 109 WHERE id = ?', [projectId]);

  console.log('[DB] Seed complete.');
}

module.exports = { getDb, initializeDatabase };
