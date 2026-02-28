// test-api.js — Quick API verification script
// Run: node test-api.js

const http = require('http');

function request(method, path, body, token) {
    return new Promise((resolve, reject) => {
        const data = body ? JSON.stringify(body) : null;
        const opts = {
            hostname: 'localhost', port: 3000, path, method,
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
                ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
            }
        };
        const req = http.request(opts, res => {
            let raw = '';
            res.on('data', d => raw += d);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, data: JSON.parse(raw) }); }
                catch { resolve({ status: res.statusCode, data: raw }); }
            });
        });
        req.on('error', reject);
        if (data) req.write(data);
        req.end();
    });
}

async function run() {
    console.log('=== API Verification ===\n');

    // 1. Login
    console.log('1. POST /api/auth/login (JD)');
    const login = await request('POST', '/api/auth/login', { email: 'jd@local.com', password: 'password1' });
    console.log(`   Status: ${login.status} | User: ${login.data.user?.full_name} | Token: ${login.data.token ? '✅ received' : '❌ missing'}`);

    if (!login.data.token) { console.log('FAILED — stopping'); process.exit(1); }
    const token = login.data.token;

    // 2. Get users
    console.log('\n2. GET /api/users');
    const users = await request('GET', '/api/users', null, token);
    console.log(`   Status: ${users.status} | Count: ${users.data.length} users`);

    // 3. Get projects
    console.log('\n3. GET /api/projects');
    const projects = await request('GET', '/api/projects', null, token);
    console.log(`   Status: ${projects.status} | Count: ${projects.data.length} projects | Name: ${projects.data[0]?.name}`);

    const projectId = projects.data[0]?.id;

    // 4. Get sprints
    console.log('\n4. GET /api/sprints?project_id=' + projectId);
    const sprints = await request('GET', `/api/sprints?project_id=${projectId}`, null, token);
    console.log(`   Status: ${sprints.status} | Count: ${sprints.data.length} sprints | Active: ${sprints.data.find(s => s.status === 'active')?.name}`);

    const sprintId = sprints.data.find(s => s.status === 'active')?.id;

    // 5. Get tickets
    console.log('\n5. GET /api/tickets?project_id=' + projectId + '&sprint_id=' + sprintId);
    const tickets = await request('GET', `/api/tickets?project_id=${projectId}&sprint_id=${sprintId}`, null, token);
    console.log(`   Status: ${tickets.status} | Count: ${tickets.data.length} tickets`);

    // 6. Get ticket detail + audit log
    const firstTicket = tickets.data[0];
    if (firstTicket) {
        console.log(`\n6. GET /api/tickets/${firstTicket.id}`);
        const detail = await request('GET', `/api/tickets/${firstTicket.id}`, null, token);
        console.log(`   Status: ${detail.status} | Title: ${detail.data.title}`);

        console.log(`\n7. GET /api/tickets/${firstTicket.id}/audit`);
        const audit = await request('GET', `/api/tickets/${firstTicket.id}/audit`, null, token);
        console.log(`   Status: ${audit.status} | Entries: ${audit.data.length}`);
        if (audit.data.length) console.log(`   Latest: ${audit.data[0].note}`);
    }

    // 7. Create a new ticket
    console.log('\n8. POST /api/tickets (create test ticket)');
    const newTicket = await request('POST', '/api/tickets', {
        title: 'Test API Ticket', description: 'Created by verification script',
        status: 'todo', priority: 'medium', type: 'task',
        project_id: projectId, sprint_id: sprintId
    }, token);
    console.log(`   Status: ${newTicket.status} | ID: ${newTicket.data.id} | Title: ${newTicket.data.title}`);

    // 8. Dashboard stats
    console.log('\n9. GET /api/dashboard/stats');
    const stats = await request('GET', '/api/dashboard/stats', null, token);
    console.log(`   Status: ${stats.status} | Statuses: ${JSON.stringify(stats.data.byStatus?.map(s => s.status + ':' + s.count))}`);

    console.log('\n=== All checks passed ✅ ===');
}

run().catch(err => { console.error('ERROR:', err); process.exit(1); });
