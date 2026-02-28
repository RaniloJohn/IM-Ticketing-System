// dashboard.js — Powers dashboard.html with live data from API

'use strict';

const API = 'http://localhost:3000/api';

// ─── Auth Guard ───────────────────────────────────────────────────────────────
const token = sessionStorage.getItem('token');
const currentUser = JSON.parse(sessionStorage.getItem('user') || 'null');
if (!token || !currentUser) {
    window.location.href = '/login.html';
}

async function api(path, options = {}) {
    const res = await fetch(`${API}${path}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            ...(options.headers || {})
        }
    });
    if (res.status === 401) { sessionStorage.clear(); window.location.href = '/login.html'; return; }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
}

// ─── State ────────────────────────────────────────────────────────────────────
let calendarDate = new Date();
let events = [];
let charts = {};

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
    injectUserInfo();
    await Promise.all([loadStats(), loadEvents()]);
    renderCalendar();
    setupEventListeners();
}

function injectUserInfo() {
    const nameEl = document.querySelector('.user-info span');
    const avatarEl = document.querySelector('.user-avatar');
    if (nameEl) nameEl.textContent = currentUser.full_name;
    if (avatarEl) {
        avatarEl.textContent = currentUser.initials;
        avatarEl.style.cursor = 'pointer';
        avatarEl.title = 'Click to log out';
        avatarEl.addEventListener('click', () => {
            if (confirm('Log out?')) { sessionStorage.clear(); window.location.href = '/login.html'; }
        });
    }
}

// ─── Stats & Charts ───────────────────────────────────────────────────────────
async function loadStats() {
    try {
        const stats = await api('/dashboard/stats');
        renderStatCards(stats);
        renderTicketChart(stats);
        renderPriorityChart(stats);
        renderRecentActivity(stats.recentActivity);
    } catch (err) {
        console.error('Failed to load stats:', err);
    }
}

function getCount(arr, key, value) {
    const item = arr.find(i => i[key] === value);
    return item ? item.count : 0;
}

function renderStatCards(stats) {
    const ids = { backlog: 'backlogCount', todo: 'todoCount', inprogress: 'inprogressCount', done: 'doneCount' };
    for (const [status, id] of Object.entries(ids)) {
        const el = document.getElementById(id);
        if (el) el.textContent = getCount(stats.byStatus, 'status', status);
    }
}

function renderTicketChart(stats) {
    const ctx = document.getElementById('ticketChart');
    if (!ctx) return;
    if (charts.ticket) charts.ticket.destroy();

    const statusColors = {
        backlog: '#ff5630', todo: '#ff8b00', inprogress: '#0052cc', done: '#36b37e'
    };
    const statusLabels = { backlog: 'Backlog', todo: 'To Do', inprogress: 'In Progress', done: 'Done' };
    const statuses = ['backlog', 'todo', 'inprogress', 'done'];

    charts.ticket = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: statuses.map(s => statusLabels[s]),
            datasets: [{
                data: statuses.map(s => getCount(stats.byStatus, 'status', s)),
                backgroundColor: statuses.map(s => statusColors[s]),
                borderWidth: 2, borderColor: '#fff'
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom' } },
            cutout: '60%'
        }
    });
}

function renderPriorityChart(stats) {
    const ctx = document.getElementById('priorityChart');
    if (!ctx) return;
    if (charts.priority) charts.priority.destroy();

    const priorities = ['critical', 'high', 'medium', 'low'];
    const colors = ['#d32f2f', '#f57c00', '#0052cc', '#388e3c'];

    charts.priority = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: priorities.map(p => p.charAt(0).toUpperCase() + p.slice(1)),
            datasets: [{
                label: 'Tickets',
                data: priorities.map(p => getCount(stats.byPriority, 'priority', p)),
                backgroundColor: colors, borderRadius: 6
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
        }
    });
}

function renderRecentActivity(activity) {
    // Inject into events list as activity feed if element exists
    const activityEl = document.getElementById('noEvents');
    const eventsListEl = document.getElementById('eventsList');
    if (!eventsListEl) return;

    // Clear placeholder
    if (activityEl) activityEl.style.display = 'none';
}

// ─── Calendar Events ──────────────────────────────────────────────────────────
async function loadEvents() {
    try {
        events = await api('/events');
        renderEventsList();
    } catch (err) {
        console.error('Failed to load events:', err);
    }
}

function renderEventsList() {
    const container = document.getElementById('eventsList');
    if (!container) return;

    const noEventsEl = document.getElementById('noEvents');

    if (events.length === 0) {
        if (noEventsEl) noEventsEl.style.display = 'block';
        return;
    }
    if (noEventsEl) noEventsEl.style.display = 'none';

    // Keep only upcoming events sorted
    const now = new Date().toISOString().slice(0, 10);
    const upcoming = events
        .filter(e => e.event_date >= now)
        .sort((a, b) => a.event_date.localeCompare(b.event_date));

    // Clear existing event items
    container.querySelectorAll('.event-item').forEach(el => el.remove());

    if (upcoming.length === 0) {
        if (noEventsEl) { noEventsEl.textContent = 'No upcoming events.'; noEventsEl.style.display = 'block'; }
        return;
    }

    upcoming.slice(0, 8).forEach(ev => {
        const item = document.createElement('div');
        item.className = `event-item ${ev.event_type}`;
        item.innerHTML = `
      <div class="event-info">
        <h4>${escHtml(ev.title)}</h4>
        <p>${escHtml(ev.event_date)}${ev.event_time ? ' · ' + escHtml(ev.event_time) : ''}</p>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:5px">
        <span class="event-time">${escHtml(ev.event_type)}</span>
        <button class="del-event-btn" data-id="${ev.id}" title="Delete">
          <i class="fas fa-trash" style="color:#ff5630;font-size:12px;cursor:pointer"></i>
        </button>
      </div>
    `;
        item.querySelector('.del-event-btn').addEventListener('click', async () => {
            if (!confirm(`Delete "${ev.title}"?`)) return;
            try {
                await api(`/events/${ev.id}`, { method: 'DELETE' });
                await loadEvents();
                renderCalendar();
                showNotification('Event deleted.');
            } catch (err) {
                showNotification(err.message, 'error');
            }
        });
        container.appendChild(item);
    });
}

// ─── Calendar ─────────────────────────────────────────────────────────────────
function renderCalendar() {
    const calEl = document.getElementById('calendar');
    if (!calEl) return;

    const monthEl = document.getElementById('currentMonth');
    if (monthEl) {
        monthEl.textContent = calendarDate.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });
    }

    const year = calendarDate.getFullYear();
    const month = calendarDate.getMonth();
    const today = new Date();

    // Event dates for this month
    const eventDates = new Set(events.map(e => e.event_date));

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();

    const dayHeaders = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    let html = '<div class="calendar-grid">';
    // Day headers
    dayHeaders.forEach(d => { html += `<div class="calendar-day">${d}</div>`; });

    // Previous month tail
    for (let i = firstDay - 1; i >= 0; i--) {
        html += `<div class="calendar-date other-month">${daysInPrevMonth - i}</div>`;
    }

    // Current month
    for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const isToday = d === today.getDate() && month === today.getMonth() && year === today.getFullYear();
        const hasEvent = eventDates.has(dateStr);

        html += `<div class="calendar-date${isToday ? ' today' : ''}${hasEvent ? ' event' : ''}" data-date="${dateStr}" onclick="handleCalendarClick('${dateStr}')">
      ${d}${hasEvent ? '<div class="event-dot"></div>' : ''}
    </div>`;
    }

    // Next month fill
    const totalCells = firstDay + daysInMonth;
    const remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    for (let d = 1; d <= remaining; d++) {
        html += `<div class="calendar-date other-month">${d}</div>`;
    }

    html += '</div>';
    calEl.innerHTML = html;
}

function handleCalendarClick(dateStr) {
    // Pre-fill event modal with selected date
    const dateInput = document.getElementById('eventDate');
    if (dateInput) dateInput.value = dateStr;
    openEventModal();
}

// ─── Event Modal ──────────────────────────────────────────────────────────────
function openEventModal() {
    const overlay = document.getElementById('eventModalOverlay');
    if (overlay) overlay.style.display = 'flex';
}

function closeEventModal() {
    const overlay = document.getElementById('eventModalOverlay');
    if (overlay) overlay.style.display = 'none';
    const form = document.getElementById('eventForm');
    if (form) form.reset();
}

async function handleSaveEvent(e) {
    e.preventDefault();
    const title = document.getElementById('eventTitle').value.trim();
    const description = document.getElementById('eventDescription').value;
    const event_date = document.getElementById('eventDate').value;
    const event_time = document.getElementById('eventTime').value;
    const event_type = document.getElementById('eventType').value;

    if (!title || !event_date) {
        showNotification('Title and date are required.', 'error');
        return;
    }

    try {
        await api('/events', {
            method: 'POST',
            body: JSON.stringify({ title, description, event_date, event_time, event_type })
        });
        closeEventModal();
        showNotification('Event saved!');
        await loadEvents();
        renderCalendar();
    } catch (err) {
        showNotification(err.message, 'error');
    }
}

// ─── Event Listeners ──────────────────────────────────────────────────────────
function setupEventListeners() {
    document.getElementById('prevMonth')?.addEventListener('click', () => {
        calendarDate.setMonth(calendarDate.getMonth() - 1);
        renderCalendar();
    });
    document.getElementById('nextMonth')?.addEventListener('click', () => {
        calendarDate.setMonth(calendarDate.getMonth() + 1);
        renderCalendar();
    });

    const addEventBtns = [document.getElementById('addEventBtn'), document.getElementById('addEventBtn2')];
    addEventBtns.forEach(btn => btn?.addEventListener('click', openEventModal));

    document.getElementById('closeEventModal')?.addEventListener('click', closeEventModal);
    document.getElementById('cancelEventBtn')?.addEventListener('click', closeEventModal);
    document.getElementById('saveEventBtn')?.addEventListener('click', handleSaveEvent);

    document.getElementById('refreshBtn')?.addEventListener('click', async () => {
        await Promise.all([loadStats(), loadEvents()]);
        renderCalendar();
        showNotification('Dashboard refreshed.');
    });

    document.getElementById('eventModalOverlay')?.addEventListener('click', (e) => {
        if (e.target.id === 'eventModalOverlay') closeEventModal();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeEventModal();
    });
}

// ─── Notification ─────────────────────────────────────────────────────────────
function showNotification(message, type = 'success') {
    const n = document.createElement('div');
    n.style.cssText = `position:fixed;top:20px;right:20px;background:${type === 'error' ? '#ff5630' : '#36b37e'};
    color:white;padding:12px 20px;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,0.2);
    z-index:9999;font-size:14px;display:flex;align-items:center;gap:8px;`;
    n.innerHTML = `<i class="fas ${type === 'error' ? 'fa-exclamation-circle' : 'fa-check-circle'}"></i>${escHtml(message)}`;
    document.body.appendChild(n);
    setTimeout(() => n.remove(), 3500);
}

function escHtml(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
