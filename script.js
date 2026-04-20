// script.js — Part 1: Auth, API, State, Board, Projects, Drag-Drop, Side Panel
'use strict';

const API = 'http://localhost:3000/api';
const token = sessionStorage.getItem('token');
const currentUser = JSON.parse(sessionStorage.getItem('user') || 'null');
if (!token || !currentUser) window.location.href = '/login.html';

// ── API helper ────────────────────────────────────────────────────────────────
async function api(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, ...(options.headers || {}) }
  });
  if (res.status === 401) { sessionStorage.clear(); window.location.href = '/login.html'; return; }
  
  const contentType = res.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  } else {
    // If not JSON, it's likely an HTML error page or raw text
    const text = await res.text();
    if (!res.ok) {
      // Try to extract a meaningful snippet from HTML if possible
      const snippet = text.length > 100 ? text.slice(0, 100) + '...' : text;
      throw new Error(`Server error (${res.status} ${res.statusText}): ${snippet}`);
    }
    return text;
  }
}

// ── State ─────────────────────────────────────────────────────────────────────
let projects = [], currentProjectId = null, allUsers = [];
let currentSprints = [], currentActiveSprint = null;
let boardTickets = [], currentPanelTicketId = null, isEditingSidePanel = false;

let currentView = 'board'; // 'board' | 'list'
let listSortField = 'id', listSortAsc = true;
let activeFilterLabel = null;
let rptCharts = {};

// ── DOM refs ─────────────────────────────────────────────────────────────────
let projectsList, projectsGrid, projectsPage, boardPage, reportsPage, timelinePage;
let projectsLink, boardLink, reportsLink, issuesLink;
let modalOverlay, projectModalOverlay, searchModalOverlay;
let ticketForm, projectForm;
let createTicketBtn, createProjectBtn;
let boardContainer, listViewContainer;
let filterBar, filterLabel;
let toggleBoardBtn, toggleListBtn;

// ── Init ──────────────────────────────────────────────────────────────────────
async function initializeApp() {
  projectsList = document.getElementById('projectsList');
  projectsGrid = document.getElementById('projectsGrid');
  projectsPage = document.getElementById('projectsPage');
  boardPage = document.getElementById('boardPage');
  reportsPage = document.getElementById('reportsPage');
  timelinePage = document.getElementById('timelinePage');
  projectsLink = document.getElementById('projectsLink');
  boardLink = document.getElementById('boardLink');
  reportsLink = document.getElementById('reportsLink');
  issuesLink = document.getElementById('issuesLink');
  modalOverlay = document.getElementById('modalOverlay');
  projectModalOverlay = document.getElementById('projectModalOverlay');
  searchModalOverlay = document.getElementById('searchModalOverlay');
  ticketForm = document.getElementById('ticketForm');
  projectForm = document.getElementById('projectForm');
  createTicketBtn = document.getElementById('createTicketBtn');
  createProjectBtn = document.getElementById('createProjectBtn');
  boardContainer = document.getElementById('boardContainer');
  listViewContainer = document.getElementById('listViewContainer');
  filterBar = document.getElementById('filterBar');
  filterLabel = document.getElementById('filterLabel');
  toggleBoardBtn = document.getElementById('toggleBoardBtn');
  toggleListBtn = document.getElementById('toggleListBtn');

  injectStyles();
  injectSidePanelHTML();
  injectUserInfo();
  await loadUsers();
  await loadProjects();
  setupEventListeners();
  setupDragAndDrop();
  setupNotifications();
}

// ── User info & logout ────────────────────────────────────────────────────────
function injectUserInfo() {
  const nameEl = document.querySelector('.user-info span');
  const avatarEl = document.querySelector('.user-avatar');
  if (nameEl) nameEl.textContent = currentUser.full_name;
  if (avatarEl) {
    avatarEl.textContent = currentUser.initials;
    avatarEl.style.cursor = 'pointer';
    avatarEl.title = 'Click to log out';
    avatarEl.addEventListener('click', () => {
      if (confirm(`Log out as ${currentUser.full_name}?`)) { sessionStorage.clear(); window.location.href = '/login.html'; }
    });
  }
}

async function loadUsers() {
  try { allUsers = await api('/users'); } catch { allUsers = []; }
  // Populate all user selects
  ['projectLead', 'searchAssignee', 'timelineAssigneeFilter'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const hasEmpty = el.querySelector('option[value=""]');
    if (!hasEmpty) el.insertAdjacentHTML('afterbegin', '<option value="">—</option>');
    allUsers.forEach(u => {
      if (!el.querySelector(`option[value="${u.initials}"]`))
        el.insertAdjacentHTML('beforeend', `<option value="${u.initials}">${escHtml(u.full_name)}</option>`);
    });
  });
}

// ── Projects ──────────────────────────────────────────────────────────────────
async function loadProjects() {
  projects = await api('/projects');
  renderProjectsList();
  renderProjectsGrid();
  if (projects.length > 0) {
    const saved = sessionStorage.getItem('currentProjectId');
    currentProjectId = (saved && projects.find(p => p.id === saved)) ? saved : projects[0].id;
    await loadBoard();
    showPage('board');
  }
}

function renderProjectsList() {
  const noMsg = document.getElementById('noProjectsMessage');
  projectsList.innerHTML = '';
  if (noMsg) { noMsg.style.display = projects.length ? 'none' : 'list-item'; projectsList.appendChild(noMsg); }
  projects.forEach(p => {
    const li = document.createElement('li');
    li.innerHTML = `<a href="#" class="${p.id === currentProjectId ? 'active' : ''}" data-id="${p.id}">
      <i class="fas fa-project-diagram"></i> ${escHtml(p.name)}</a>`;
    li.querySelector('a').addEventListener('click', async e => {
      e.preventDefault();
      currentProjectId = p.id; sessionStorage.setItem('currentProjectId', p.id);
      clearFilter(); await loadBoard(); showPage('board'); renderProjectsList();
    });
    projectsList.appendChild(li);
  });
}

function renderProjectsGrid() {
  const emptyMsg = document.getElementById('emptyProjectsMessage');
  if (emptyMsg) emptyMsg.style.display = projects.length ? 'none' : 'flex';
  projectsGrid.querySelectorAll('.project-card').forEach(c => c.remove());
  projects.forEach(p => {
    const card = document.createElement('div');
    card.className = 'project-card';
    card.innerHTML = `
      <div class="project-card-header"><h3>${escHtml(p.name)}</h3><span class="project-key">${escHtml(p.key)}</span></div>
      <div class="project-card-body">
        <p>${escHtml(p.description || 'No description')}</p>
        <div class="project-stats">
          <span><i class="fas fa-tasks"></i> ${p.ticket_count || 0} tickets</span>
          <span><i class="fas fa-user"></i> ${escHtml(p.lead_name || 'No lead')}</span>
        </div>
      </div>
      <div class="project-card-footer">
        <button class="btn btn-primary btn-small open-project-btn">Open Board</button>
        <button class="btn btn-outline btn-small delete-project-btn">Delete</button>
      </div>`;
    card.querySelector('.open-project-btn').addEventListener('click', async () => {
      currentProjectId = p.id; sessionStorage.setItem('currentProjectId', p.id);
      clearFilter(); await loadBoard(); showPage('board'); renderProjectsList();
    });
    card.querySelector('.delete-project-btn').addEventListener('click', async () => {
      if (!confirm(`Delete project "${p.name}"? This cannot be undone.`)) return;
      try { await api(`/projects/${p.id}`, { method: 'DELETE' }); showNotification('Project deleted.'); await loadProjects(); }
      catch (err) { showNotification(err.message, 'error'); }
    });
    projectsGrid.appendChild(card);
  });
}

// ── Board ─────────────────────────────────────────────────────────────────────
async function loadBoard() {
  if (!currentProjectId) return;
  const project = projects.find(p => p.id === currentProjectId);
  if (!project) return;
  document.getElementById('currentProjectName').textContent = project.name;
  document.getElementById('currentProjectDescription').textContent = project.description || '';
  currentSprints = await api(`/sprints?project_id=${currentProjectId}`);
  currentActiveSprint = currentSprints.find(s => s.status === 'active') || null;
  const sprintParam = currentActiveSprint ? currentActiveSprint.id : 'null';
  boardTickets = await api(`/tickets?project_id=${currentProjectId}&sprint_id=${sprintParam}`);
  renderBoard(boardTickets);
  if (currentView === 'list') renderListView(boardTickets);
}

function renderBoard(tickets) {
  ['new', 'active', 'resolved', 'closed'].forEach(s => { const c = document.getElementById(`${s}Column`); if (c) c.innerHTML = ''; });
  tickets.forEach(t => {
    const col = document.getElementById(`${t.status}Column`);
    if (col) col.appendChild(createTicketElement(t));
  });
  updateTicketCounts();
}

function createTicketElement(ticket) {
  const el = document.createElement('div');
  el.className = `ticket ${ticket.status}${ticket.is_escalated ? ' escalated-ticket' : ''}`;
  el.setAttribute('data-id', ticket.id);
  el.setAttribute('draggable', 'true');
  const isOverdue = ticket.due_date && new Date(ticket.due_date) < new Date() && ticket.status !== 'done';
  const labels = ticket.labels ? ticket.labels.split(',').filter(Boolean) : [];
  el.innerHTML = `
    <div class="ticket-header">
      <div class="ticket-id">${escHtml(ticket.id)}</div>
      <div class="ticket-priority priority-${ticket.priority}">${ticket.priority}</div>
    </div>
    ${ticket.is_escalated ? '<div class="escalated-badge"><i class="fas fa-exclamation-triangle"></i> Escalated</div>' : ''}
    <div class="ticket-title">${escHtml(ticket.title)}</div>
    ${labels.length ? `<div class="ticket-labels">${labels.map(l => `<span class="label-tag">${escHtml(l.trim())}</span>`).join('')}</div>` : ''}
    <div class="ticket-footer">
      <div style="display:flex;gap:6px;align-items:center;">
        <div class="ticket-type">${ticket.type}</div>
        ${ticket.story_points ? `` : ''}
        ${ticket.subtask_count > 0 ? `<span class="subtask-count"><i class="fas fa-sitemap"></i>${ticket.subtask_count}</span>` : ''}
        ${ticket.comment_count > 0 ? `<span class="comment-count"><i class="fas fa-comment"></i>${ticket.comment_count}</span>` : ''}
      </div>
      <div style="display:flex;gap:4px;align-items:center;">
        ${isOverdue ? `<span class="overdue-badge" title="Overdue: ${ticket.due_date}"><i class="fas fa-clock"></i></span>` : ''}
        <div class="ticket-assignee" title="${escHtml(ticket.assignee_name || 'Unassigned')}">${escHtml(ticket.assignee_initials || '?')}</div>
      </div>
    </div>`;
  el.addEventListener('dragstart', handleDragStart);
  el.addEventListener('click', () => openSidePanel(ticket.id));
  return el;
}

function updateTicketCounts() {
  ['new', 'active', 'resolved', 'closed'].forEach(s => {
    const col = document.getElementById(`${s}Column`);
    const countEl = col?.closest('.board-column')?.querySelector('.ticket-count');
    if (countEl) countEl.textContent = col.children.length;
  });
}

// ── View switching ────────────────────────────────────────────────────────────
function switchView(view) {
  currentView = view;
  const isList = view === 'list';
  boardContainer.style.display = isList ? 'none' : 'flex';
  listViewContainer.style.display = isList ? 'block' : 'none';
  toggleBoardBtn.classList.toggle('active', !isList);
  toggleListBtn.classList.toggle('active', isList);
  document.getElementById('listViewLink').classList.toggle('active', isList);
  document.getElementById('boardViewLink').classList.toggle('active', !isList);
  if (isList) renderListView(boardTickets);
}

// ── List View ─────────────────────────────────────────────────────────────────
function renderListView(tickets) {
  const kw = document.getElementById('listSearch')?.value.toLowerCase() || '';
  const st = document.getElementById('listStatusFilter')?.value || '';
  const pr = document.getElementById('listPriorityFilter')?.value || '';

  let filtered = tickets.filter(t => {
    if (st && t.status !== st) return false;
    if (pr && t.priority !== pr) return false;
    if (kw && !t.title.toLowerCase().includes(kw) && !(t.description || '').toLowerCase().includes(kw)) return false;
    return true;
  });

  filtered.sort((a, b) => {
    let av = a[listSortField] ?? '', bv = b[listSortField] ?? '';
    if (av < bv) return listSortAsc ? -1 : 1;
    if (av > bv) return listSortAsc ? 1 : -1;
    return 0;
  });

  const tbody = document.getElementById('listViewBody');
  tbody.innerHTML = filtered.length ? '' : '<tr><td colspan="9" style="text-align:center;padding:32px;color:#5e6c84">No tickets match the current filters.</td></tr>';

  const statusColors = { new: '#0052cc', active: '#ff8b00', resolved: '#36b37e', closed: '#6554c0' };
  const priorityColors = { critical: '#d32f2f', high: '#f57c00', medium: '#0052cc', low: '#388e3c' };

  filtered.forEach(t => {
    const isOverdue = t.due_date && new Date(t.due_date) < new Date() && t.status !== 'closed';
    const tr = document.createElement('tr');
    tr.className = 'list-row';
    tr.innerHTML = `
      <td><span class="list-id">${escHtml(t.id)}</span></td>
      <td class="list-title-cell">
        ${t.is_escalated ? '<i class="fas fa-exclamation-triangle" style="color:#ff5630;margin-right:6px;" title="Escalated"></i>' : ''}
        <span class="list-title-text">${escHtml(t.title)}</span>
      </td>
      <td><span class="status-pill" style="background:${statusColors[t.status] || '#999'}">${t.status}</span></td>
      <td><span class="priority-pill" style="background:${priorityColors[t.priority] || '#999'}">${t.priority}</span></td>
      <td><span class="type-pill">${t.type}</span></td>
      <td>${escHtml(t.assignee_name || t.assignee_initials || '—')}</td>
      <td style="${isOverdue ? 'color:#ff5630;font-weight:600' : ''}">${t.due_date ? `<i class="fas fa-calendar-day" style="margin-right:4px;opacity:.6"></i>${t.due_date}${isOverdue ? ' <i class="fas fa-exclamation-circle"></i>' : ''}` : '—'}</td>
      <td style="text-align:center">${t.is_escalated ? '<i class="fas fa-fire" style="color:#ff5630"></i>' : ''}</td>`;
    tr.addEventListener('click', () => openSidePanel(t.id));
    tbody.appendChild(tr);
  });
}

// ── Filters ───────────────────────────────────────────────────────────────────
function showFilter(label, tickets) {
  activeFilterLabel = label;
  filterLabel.innerHTML = `<i class="fas fa-filter"></i> ${label}`;
  filterBar.style.display = 'flex';
  renderBoard(tickets);
  if (currentView === 'list') renderListView(tickets);
  showPage('board');
}

function clearFilter() {
  activeFilterLabel = null;
  if (filterBar) filterBar.style.display = 'none';
  renderBoard(boardTickets);
  if (currentView === 'list') renderListView(boardTickets);
}

async function applyFilter(label, paramsFn) {
  if (!currentProjectId) { showNotification('Please select a project first.', 'error'); return; }
  try {
    const allProjectTickets = await api(`/tickets?project_id=${currentProjectId}`);
    const filtered = paramsFn(allProjectTickets);
    showFilter(label, filtered);
    showNotification(`Showing: ${label} (${filtered.length} tickets)`);
  } catch (err) { showNotification(err.message, 'error'); }
}

// ── Drag & Drop ───────────────────────────────────────────────────────────────
function setupDragAndDrop() {
  document.querySelectorAll('.column-content').forEach(col => {
    col.addEventListener('dragover', e => { e.preventDefault(); col.classList.add('drag-over'); });
    col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
    col.addEventListener('drop', handleDrop);
  });
  document.addEventListener('dragend', e => { if (e.target.classList?.contains('ticket')) { e.target.classList.remove('dragging'); document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over')); } });
}

function handleDragStart(e) {
  e.dataTransfer.setData('text/plain', e.currentTarget.getAttribute('data-id'));
  e.currentTarget.classList.add('dragging');
}

async function handleDrop(e) {
  e.preventDefault();
  const col = e.currentTarget;
  col.classList.remove('drag-over');
  const ticketId = e.dataTransfer.getData('text/plain');
  const draggedEl = document.querySelector(`[data-id="${ticketId}"]`);
  if (!draggedEl) return;
  const newStatus = col.closest('.board-column').getAttribute('data-status');

  // Strict forward-only workflow check
  const ticket = boardTickets.find(t => t.id === ticketId);
  if (!ticket) return;
  const currentStatus = ticket.status;

  const statusOrder = { 'new': 0, 'active': 1, 'resolved': 2, 'closed': 3 };
  if (statusOrder[newStatus] < statusOrder[currentStatus]) {
    showNotification('Incidents cannot be moved backwards in the workflow.', 'error');
    return;
  }

  draggedEl.classList.remove('dragging');
  draggedEl.className = `ticket ${newStatus}`;
  col.appendChild(draggedEl);
  updateTicketCounts();
  try {
    await api(`/tickets/${ticketId}`, { method: 'PUT', body: JSON.stringify({ status: newStatus }) });
    ticket.status = newStatus;
  } catch { showNotification('Failed to update ticket status.', 'error'); await loadBoard(); }
}

function injectSidePanelHTML() {
  if (document.getElementById('incidentModal')) return;
  const modal = document.createElement('div');
  modal.id = 'incidentModal';
  modal.className = 'incident-modal-overlay';
  modal.innerHTML = `
    <div class="incident-modal">
      <div class="incident-modal-header">
        <div class="incident-modal-title-row">
          <div class="incident-id-badge" id="spTicketId"></div>
          <h2 id="spTitle" class="incident-title"></h2>
        </div>
        <div class="incident-modal-header-actions">
          <button id="spEditBtn" class="btn btn-small btn-outline"><i class="fas fa-edit"></i> Edit</button>
          <button id="spSaveBtn" class="btn btn-small btn-primary" style="display:none"><i class="fas fa-save"></i> Save</button>
          <button id="spCancelBtn" class="btn btn-small btn-outline" style="display:none"><i class="fas fa-times"></i> Cancel</button>
          <button id="spCloseBtn" class="btn btn-small btn-outline"><i class="fas fa-times"></i> Close</button>
        </div>

      </div>
      <div class="incident-modal-body">
        <div class="incident-modal-left">
          <div class="sp-section">
            <label><i class="fas fa-traffic-light"></i> Status</label>
            <div id="spStatusBtns" class="status-transition-btns"></div>
          </div>
          <div class="sp-section">
            <label><i class="fas fa-align-left"></i> Description</label>
            <div id="spDescription" class="rte-body" style="min-height:80px;"></div>
          </div>
          <div class="sp-section">
            <label><i class="fas fa-exclamation-circle"></i> Business Impact</label>
            <div id="spBusinessImpact" class="rte-body" style="min-height:60px;"></div>
          </div>
          <div class="sp-section">
            <label><i class="fas fa-arrow-right"></i> Next Step</label>
            <div id="spNextStep" class="rte-body" style="min-height:60px;"></div>
          </div>
          <div class="sp-section">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
              <label style="margin:0"><i class="fas fa-eye"></i> Watchers</label>
              <button id="spWatchBtn" class="btn btn-small btn-outline">&#9734; Watch</button>
            </div>
            <div id="spWatchers" class="sp-watchers"></div>
          </div>
          <div class="sp-section">
            <label><i class="fas fa-sitemap"></i> Subtasks</label>
            <div id="spSubtasks"></div>
            <div style="display:flex;gap:8px;margin-top:10px">
              <input type="text" id="spSubtaskInput" placeholder="Add a subtask..." class="sp-input" style="flex:1">
              <button class="btn btn-small btn-primary" id="spAddSubtaskBtn">Add</button>
            </div>
          </div>
          <div class="sp-section">
            <label><i class="fas fa-comments"></i> Comments</label>
            <div id="spComments"></div>
            <div style="display:flex;gap:10px;margin-top:12px;align-items:flex-end">
              <textarea id="spCommentInput" class="sp-textarea" rows="3" placeholder="Add a comment or update..." style="flex:1"></textarea>
              <button class="btn btn-small btn-primary" id="spAddCommentBtn"><i class="fas fa-paper-plane"></i></button>
            </div>
          </div>
          <div class="sp-section">
            <label><i class="fas fa-history"></i> Activity Log</label>
            <div id="spAuditLog" class="sp-audit-log"></div>
          </div>
        </div>
        <div class="incident-modal-right">
          <div class="sp-section">
            <label>Assignee</label>
            <div id="spAssignee" class="sp-text"></div>
          </div>
          <div class="sp-section">
            <label>Reporter</label>
            <div id="spReporter" class="sp-text"></div>
          </div>
          <div class="sp-section" style="margin-top:auto;padding-top:20px;border-top:1px solid var(--border)">
            <div style="font-size:11px;color:var(--text-light);">
              <div id="spCreatedAt"></div>
              <div id="spUpdatedAt"></div>
            </div>
          </div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) closeSidePanel(); });
  document.getElementById('spCloseBtn').addEventListener('click', closeSidePanel);
  document.getElementById('spEditBtn').addEventListener('click', toggleEditMode);
  document.getElementById('spSaveBtn').addEventListener('click', saveTicketEdits);
  document.getElementById('spCancelBtn').addEventListener('click', () => { isEditingSidePanel = false; refreshSidePanel(currentPanelTicketId); });
  document.getElementById('spWatchBtn').addEventListener('click', toggleWatch);

  document.getElementById('spAddCommentBtn').addEventListener('click', addComment);
  document.getElementById('spAddSubtaskBtn').addEventListener('click', addSubtask);
}

async function openSidePanel(ticketId) {
  currentPanelTicketId = ticketId;
  document.getElementById('incidentModal').classList.add('open');
  document.body.style.overflow = 'hidden';
  await refreshSidePanel(ticketId);
}

async function refreshSidePanel(id) {
  try {
    const [ticket, comments, auditLog, subtasks] = await Promise.all([
      api(`/tickets/${id}`), api(`/tickets/${id}/comments`),
      api(`/tickets/${id}/audit`), api(`/tickets/${id}/subtasks`)
    ]);
    renderSidePanel(ticket, comments, auditLog, subtasks);
  } catch (err) { showNotification('Failed to load ticket: ' + err.message, 'error'); }
}

function renderSidePanel(ticket, comments, auditLog, subtasks) {
  const editBtn = document.getElementById('spEditBtn');
  const saveBtn = document.getElementById('spSaveBtn');
  const cancelBtn = document.getElementById('spCancelBtn');

  if (editBtn) editBtn.style.display = isEditingSidePanel ? 'none' : 'inline-block';
  if (saveBtn) saveBtn.style.display = isEditingSidePanel ? 'inline-block' : 'none';
  if (cancelBtn) cancelBtn.style.display = isEditingSidePanel ? 'inline-block' : 'none';

  document.getElementById('spTicketId').textContent = ticket.id;
  
  if (isEditingSidePanel) {
    document.getElementById('spTitle').innerHTML = `<input type="text" id="spTitleInput" class="sp-input" value="${escHtml(ticket.title)}">`;
    document.getElementById('spDescription').innerHTML = `<textarea id="spDescriptionInput" class="sp-textarea">${escHtml(ticket.description || '')}</textarea>`;
    document.getElementById('spBusinessImpact').innerHTML = `<textarea id="spBusinessImpactInput" class="sp-textarea">${escHtml(ticket.business_impact || '')}</textarea>`;
    document.getElementById('spNextStep').innerHTML = `<textarea id="spNextStepInput" class="sp-textarea">${escHtml(ticket.next_step || '')}</textarea>`;
  } else {
    document.getElementById('spTitle').textContent = ticket.title;
    document.getElementById('spDescription').innerHTML = ticket.description || '<span style="color:#5e6c84;font-size:13px">No description</span>';
    document.getElementById('spBusinessImpact').innerHTML = ticket.business_impact
      ? escHtml(ticket.business_impact).replace(/\n/g, '<br>')
      : '<span style="color:#5e6c84;font-size:13px">—</span>';
    document.getElementById('spNextStep').innerHTML = ticket.next_step
      ? escHtml(ticket.next_step).replace(/\n/g, '<br>')
      : '<span style="color:#5e6c84;font-size:13px">—</span>';
  }

  document.getElementById('spAssignee').textContent = ticket.assignee_name || ticket.assignee_initials || 'Unassigned';
  document.getElementById('spReporter').textContent = ticket.reporter_name || ticket.reporter_initials || '—';

  const statuses = [['new', 'fa-circle-notch', 'New'], ['active', 'fa-bolt', 'Active'], ['resolved', 'fa-check-double', 'Resolved'], ['closed', 'fa-lock', 'Closed']];
  const order = { 'new': 0, 'active': 1, 'resolved': 2, 'closed': 3 };
  const currentLevel = order[ticket.status] || 0;

  document.getElementById('spStatusBtns').innerHTML = statuses.map(([v, icon, lbl]) => {
    const isPast = order[v] < currentLevel;
    const isActive = ticket.status === v;
    const disabledAttr = isPast ? 'disabled title="Cannot move backward"' : '';
    const opacityStyle = isPast ? 'style="opacity:0.4;cursor:not-allowed"' : '';
    return `<button class="status-btn ${v}${isActive ? ' active' : ''}" ${disabledAttr} ${opacityStyle} onclick="updateTicketField('status','${v}')"><i class="fas ${icon}"></i> ${lbl}</button>`;
  }).join('');

  // Timestamps
  const created = document.getElementById('spCreatedAt');
  const updated = document.getElementById('spUpdatedAt');
  if (isEditingSidePanel) {
    created.innerHTML = `<label style="font-size:10px;display:block">Created</label><input type="datetime-local" id="spCreatedAtInput" class="sp-input" style="font-size:11px;padding:4px" value="${sqliteToLocalISO(ticket.created_at)}">`;
    updated.innerHTML = `<label style="font-size:10px;display:block;margin-top:5px">Updated</label><input type="datetime-local" id="spUpdatedAtInput" class="sp-input" style="font-size:11px;padding:4px" value="${sqliteToLocalISO(ticket.updated_at)}">`;
  } else {
    if (created) created.textContent = ticket.created_at ? `Created: ${fmtDate(ticket.created_at)}` : '';
    if (updated) updated.textContent = ticket.updated_at ? `Updated: ${fmtDate(ticket.updated_at)}` : '';
  }


  const isWatching = ticket.watchers?.some(w => w.user_initials === currentUser.initials);
  const wb = document.getElementById('spWatchBtn'); wb.textContent = isWatching ? '★ Watching' : '☆ Watch'; wb.dataset.watching = isWatching;
  document.getElementById('spWatchers').innerHTML = ticket.watchers?.length
    ? ticket.watchers.map(w => `<span class="watcher-chip">${escHtml(w.full_name)}</span>`).join('') : '<span style="color:#5e6c84;font-size:13px">No watchers</span>';

  document.getElementById('spSubtasks').innerHTML = subtasks.length
    ? subtasks.map(st => `<div class="subtask-item"><input type="checkbox" data-id="${st.id}" ${st.status === 'done' ? 'checked' : ''}><span class="${st.status === 'done' ? 'done-text' : ''}">${escHtml(st.title)}</span><span class="subtask-id">${st.id}</span></div>`).join('')
    : '<p style="color:#5e6c84;font-size:13px">No subtasks</p>';
  document.getElementById('spSubtasks').querySelectorAll('input[type=checkbox]').forEach(cb =>
    cb.addEventListener('change', () => updateSubtaskStatus(cb.dataset.id, cb.checked)));

  document.getElementById('spComments').innerHTML = comments.length
    ? comments.map(c => `
      <div class="sp-comment">
        <div class="sp-comment-meta">
          <span class="sp-avatar-mini small">${c.author_initials}</span>
          <strong>${escHtml(c.author_name || c.author_initials)}</strong>
          <span id="commentTime-${c.id}" class="sp-timestamp">${fmtDate(c.created_at)}</span>
          <button class="btn-icon" style="margin-left:auto" onclick="toggleCommentEdit(${c.id})" title="Edit comment"><i class="fas fa-pencil-alt"></i></button>
        </div>
        <div id="commentBody-${c.id}" class="sp-comment-body" onclick="toggleCommentEdit(${c.id})" style="cursor:pointer" title="Click to edit">${escHtml(c.content)}</div>
        <div id="commentEditArea-${c.id}" style="display:none;margin-top:10px">
          <textarea id="commentEdit-${c.id}" class="sp-textarea" style="min-height:50px">${escHtml(c.content)}</textarea>
          <div style="display:flex;gap:8px;margin-top:5px;align-items:center">
            <input type="datetime-local" id="commentDate-${c.id}" class="sp-input" style="font-size:11px;padding:4px;width:auto" value="${sqliteToLocalISO(c.created_at)}">
            <button class="btn btn-small btn-primary" onclick="updateComment(${c.id})">Save</button>
            <button class="btn btn-small btn-outline" onclick="refreshSidePanel(currentPanelTicketId)">Cancel</button>
          </div>
        </div>
      </div>`).join('')
    : '<p style="color:#5e6c84;font-size:13px">No comments yet</p>';


  document.getElementById('spAuditLog').innerHTML = auditLog.length
    ? auditLog.map(e => `
      <div class="audit-entry">
        <div class="audit-header" style="display:flex;justify-content:space-between">
          <div class="audit-timestamp">${fmtDate(e.timestamp)}</div>
          <button class="btn-icon" onclick="toggleAuditEdit(${e.id})" title="Edit log entry"><i class="fas fa-pencil-alt"></i></button>
        </div>
        <div class="audit-body">
          <span class="sp-avatar-mini small">${e.changed_by}</span>
          <span id="auditNote-${e.id}" class="audit-note" onclick="toggleAuditEdit(${e.id})" style="cursor:pointer" title="Click to edit">${escHtml(e.note || e.action)}</span>
        </div>
        <div id="auditEditArea-${e.id}" style="display:none;margin-top:8px">
          <input type="text" id="auditEdit-${e.id}" class="sp-input" value="${escHtml(e.note || e.action)}">
          <div style="display:flex;gap:8px;margin-top:5px;align-items:center">
            <input type="datetime-local" id="auditDate-${e.id}" class="sp-input" style="font-size:11px;padding:4px;width:auto" value="${sqliteToLocalISO(e.timestamp)}">
            <button class="btn btn-small btn-primary" onclick="updateAuditLog(${e.id})">Save</button>
            <button class="btn btn-small btn-outline" onclick="refreshSidePanel(currentPanelTicketId)">Cancel</button>
          </div>
        </div>
      </div>`).join('')
    : '<p style="color:#5e6c84;font-size:13px">No activity yet</p>';

}

function closeSidePanel() {
  document.getElementById('incidentModal').classList.remove('open');
  document.body.style.overflow = '';
  currentPanelTicketId = null;
  loadBoard();
}

async function deleteCurrentTicket() {
  if (!currentPanelTicketId) return;
  // First confirmation
  const ticket = boardTickets.find(t => t.id === currentPanelTicketId);
  const ticketLabel = ticket ? `"${ticket.title}" (${currentPanelTicketId})` : currentPanelTicketId;

  const confirmed = confirm(
    `⚠️ Are you sure you want to delete ticket ${ticketLabel}?\n\n` +
    `This will permanently remove the ticket, all its comments, subtasks, ` +
    `watchers, and audit history. This action CANNOT be undone.`
  );
  if (!confirmed) return;

  // Second confirmation for safety
  const doubleConfirmed = confirm(`Delete ${currentPanelTicketId} permanently? Click OK to confirm.`);
  if (!doubleConfirmed) return;

  try {
    await api(`/tickets/${currentPanelTicketId}`, { method: 'DELETE' });
    closeSidePanel();
    showNotification(`Ticket ${currentPanelTicketId} deleted.`);
    await loadBoard();
  } catch (err) {
    showNotification('Failed to delete ticket: ' + err.message, 'error');
  }
}

async function updateTicketField(field, value) {
  if (!currentPanelTicketId) return;
  try {
    await api(`/tickets/${currentPanelTicketId}`, { method: 'PUT', body: JSON.stringify({ [field]: value }) });
    boardTickets = await api(`/tickets?project_id=${currentProjectId}&sprint_id=${currentActiveSprint?.id || 'null'}`);
    renderBoard(boardTickets);
    if (currentView === 'list') renderListView(boardTickets);
    await refreshSidePanel(currentPanelTicketId);
  } catch (err) { showNotification(err.message, 'error'); }
}

async function toggleEscalate() {
  const btn = document.getElementById('spEscalateBtn');
  await updateTicketField('is_escalated', parseInt(btn.dataset.currentVal) === 1 ? 0 : 1);
}

async function toggleWatch() {
  const btn = document.getElementById('spWatchBtn');
  const isWatching = btn.dataset.watching === 'true';
  try {
    await api(`/tickets/${currentPanelTicketId}/watch`, { method: isWatching ? 'DELETE' : 'POST' });
    await refreshSidePanel(currentPanelTicketId);
    showNotification(isWatching ? 'Stopped watching.' : 'Now watching this ticket.');
  } catch (err) { showNotification(err.message, 'error'); }
}

async function addComment() {
  const input = document.getElementById('spCommentInput');
  const content = input.value.trim();
  if (!content || !currentPanelTicketId) return;
  try { await api(`/tickets/${currentPanelTicketId}/comments`, { method: 'POST', body: JSON.stringify({ content }) }); input.value = ''; await refreshSidePanel(currentPanelTicketId); }
  catch (err) { showNotification(err.message, 'error'); }
}

async function addSubtask() {
  const input = document.getElementById('spSubtaskInput');
  const title = input.value.trim();
  if (!title || !currentPanelTicketId) return;
  try { await api(`/tickets/${currentPanelTicketId}/subtasks`, { method: 'POST', body: JSON.stringify({ title }) }); input.value = ''; await refreshSidePanel(currentPanelTicketId); showNotification('Subtask added.'); }
  catch (err) { showNotification(err.message, 'error'); }
}

async function updateSubtaskStatus(id, done) {
  try { await api(`/tickets/${id}`, { method: 'PUT', body: JSON.stringify({ status: done ? 'done' : 'todo' }) }); }
  catch (err) { showNotification(err.message, 'error'); }
}

function toggleEditMode() {
  isEditingSidePanel = !isEditingSidePanel;
  refreshSidePanel(currentPanelTicketId);
}

async function saveTicketEdits() {
  if (!currentPanelTicketId) return;
  const title = document.getElementById('spTitleInput')?.value;
  const description = document.getElementById('spDescriptionInput')?.value;
  const businessImpact = document.getElementById('spBusinessImpactInput')?.value;
  const nextStep = document.getElementById('spNextStepInput')?.value;
  const createdAt = localISOToSqlite(document.getElementById('spCreatedAtInput')?.value);
  const updatedAt = localISOToSqlite(document.getElementById('spUpdatedAtInput')?.value);

  const body = {};
  if (title !== undefined) body.title = title;
  if (description !== undefined) body.description = description;
  if (businessImpact !== undefined) body.business_impact = businessImpact;
  if (nextStep !== undefined) body.next_step = nextStep;
  if (createdAt) body.created_at = createdAt;
  if (updatedAt) body.updated_at = updatedAt;

  try {
    await api(`/tickets/${currentPanelTicketId}`, { method: 'PUT', body: JSON.stringify(body) });
    showNotification('Ticket updated successfully.');
    isEditingSidePanel = false;
    await loadBoard();
    await refreshSidePanel(currentPanelTicketId);
  } catch (err) {
    showNotification('Update failed: ' + err.message, 'error');
  }
}

function sqliteToLocalISO(sqlite) {
  if (!sqlite) return '';
  try {
    // Current database stores UTC: "YYYY-MM-DD HH:MM:SS"
    const utc = sqlite.includes('T') ? sqlite : sqlite.replace(' ', 'T') + 'Z';
    const d = new Date(utc);
    if (isNaN(d.getTime())) return '';
    
    // Extract local components for datetime-local input (YYYY-MM-DDTHH:MM)
    const Y = d.getFullYear();
    const M = String(d.getMonth() + 1).padStart(2, '0');
    const D = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    return `${Y}-${M}-${D}T${h}:${m}`;
  } catch { return ''; }
}

function localISOToSqlite(local) {
  if (!local) return null;
  try {
    // 'local' is "YYYY-MM-DDTHH:MM" from browser input
    const d = new Date(local);
    if (isNaN(d.getTime())) return null;
    // Store as UTC in SQLite format: "YYYY-MM-DD HH:MM:SS"
    return d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
  } catch { return null; }
}

async function updateComment(commentId) {
  const content = document.getElementById(`commentEdit-${commentId}`).value;
  const createdAt = localISOToSqlite(document.getElementById(`commentDate-${commentId}`).value);
  try {
    await api(`/tickets/comments/${commentId}`, { method: 'PUT', body: JSON.stringify({ content, created_at: createdAt }) });
    showNotification('Comment updated.');
    refreshSidePanel(currentPanelTicketId);
  } catch (err) { showNotification(err.message, 'error'); }
}

async function updateAuditLog(logId) {
  const note = document.getElementById(`auditEdit-${logId}`).value;
  const timestamp = localISOToSqlite(document.getElementById(`auditDate-${logId}`).value);
  try {
    await api(`/tickets/audit/${logId}`, { method: 'PUT', body: JSON.stringify({ note, timestamp }) });
    showNotification('Activity log entry updated.');
    refreshSidePanel(currentPanelTicketId);
  } catch (err) { showNotification(err.message, 'error'); }
}

function toggleCommentEdit(id) {
  const area = document.getElementById(`commentEditArea-${id}`);
  const body = document.getElementById(`commentBody-${id}`);
  const isHidden = area.style.display === 'none';
  area.style.display = isHidden ? 'block' : 'none';
  body.style.display = isHidden ? 'none' : 'block';
}

function toggleAuditEdit(id) {
  const area = document.getElementById(`auditEditArea-${id}`);
  const note = document.getElementById(`auditNote-${id}`);
  const isHidden = area.style.display === 'none';
  area.style.display = isHidden ? 'block' : 'none';
  note.style.display = isHidden ? 'none' : 'block';
}


// ── Ticket Creation ────────────────────────────────────────────────────────────
async function handleTicketFormSubmit(e) {
  e.preventDefault();
  const title = document.getElementById('ticketTitle').value.trim();
  if (!title) { showNotification('Title is required.', 'error'); return; }
  if (!currentProjectId) { showNotification('Please select a project first.', 'error'); return; }
  try {
    const ticket = await api('/tickets', {
      method: 'POST',
      body: JSON.stringify({
        title,
        description: document.getElementById('ticketDescription').value,
        business_impact: document.getElementById('ticketBusinessImpact').value.trim() || null,
        next_step: document.getElementById('ticketNextStep').value.trim() || null,
        status: 'new',
        priority: 'medium',
        type: 'incident',
        assignee_name: document.getElementById('ticketAssignee').value.trim() || null,
        labels: document.getElementById('ticketLabels').value,
        project_id: currentProjectId,
        sprint_id: currentActiveSprint ? currentActiveSprint.id : null
      })
    });
    closeTicketModal();
    showNotification(`Ticket ${ticket.id} created!`);
    await loadBoard();
  } catch (err) { showNotification(err.message, 'error'); }
}

// ── Project Creation ───────────────────────────────────────────────────────────
async function handleProjectFormSubmit(e) {
  e.preventDefault();
  const name = document.getElementById('projectName').value.trim();
  const key = document.getElementById('projectKey').value.trim().toUpperCase();
  if (!name || !key) { showNotification('Name and key are required.', 'error'); return; }
  try {
    const project = await api('/projects', {
      method: 'POST',
      body: JSON.stringify({
        name, key,
        description: document.getElementById('projectDescription').value,
        lead_initials: document.getElementById('projectLead').value
      })
    });
    closeProjectModal();
    showNotification(`Project "${project.name}" created!`);
    currentProjectId = project.id;
    sessionStorage.setItem('currentProjectId', project.id);
    await loadProjects();
    showPage('board');
  } catch (err) { showNotification(err.message, 'error'); }
}

// ── Modals ─────────────────────────────────────────────────────────────────────
function openTicketModal() {
  if (!currentProjectId) { showNotification('Please select a project first.', 'error'); return; }
  modalOverlay.style.display = 'flex';
  document.getElementById('ticketTitle').focus();
}
function closeTicketModal() { modalOverlay.style.display = 'none'; ticketForm?.reset(); }
function openProjectModal() { projectModalOverlay.style.display = 'flex'; document.getElementById('projectName').focus(); }
function closeProjectModal() { projectModalOverlay.style.display = 'none'; projectForm?.reset(); }
function openSearchModal() {
  searchModalOverlay.style.display = 'flex';
  document.getElementById('searchKeyword').focus();
  // Populate assignee dropdown
  const sel = document.getElementById('searchAssignee');
  if (sel.children.length <= 1) {
    allUsers.forEach(u => sel.insertAdjacentHTML('beforeend', `<option value="${u.initials}">${escHtml(u.full_name)}</option>`));
  }
}
function closeSearchModal() { searchModalOverlay.style.display = 'none'; document.getElementById('searchResults').style.display = 'none'; }

// ── Reports ────────────────────────────────────────────────────────────────────
async function showReports() {
  showPage('reports');
  if (!currentProjectId) { showNotification('Select a project first.', 'error'); return; }
  const project = projects.find(p => p.id === currentProjectId);
  if (project) document.getElementById('reportsProjectName').textContent = `Project: ${project.name}`;

  try {
    const tickets = await api(`/tickets?project_id=${currentProjectId}`);
    buildReportCharts(tickets);
  } catch (err) { showNotification(err.message, 'error'); }
}

function buildReportCharts(tickets) {
  // Destroy old charts
  Object.values(rptCharts).forEach(c => c.destroy());
  rptCharts = {};

  const count = (arr, key) => arr.reduce((acc, t) => { acc[t[key]] = (acc[t[key]] || 0) + 1; return acc; }, {});

  const palette = ['#0052cc', '#36b37e', '#ff8b00', '#ff5630', '#6554c0', '#00b8d9', '#ff991f'];

  const makeChart = (id, type, labels, data, colors) => {
    const ctx = document.getElementById(id)?.getContext('2d');
    if (!ctx) return;
    rptCharts[id] = new Chart(ctx, {
      type, data: {
        labels,
        datasets: [{ data, backgroundColor: colors || palette.slice(0, data.length), borderWidth: type === 'bar' ? 0 : 2, borderColor: '#fff' }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: type === 'bar' ? 'top' : 'right', labels: { font: { size: 12 } } } },
        ...(type === 'bar' ? { scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } } : {})
      }
    });
  };

  const statusMap = count(tickets, 'status');
  makeChart('rptStatusChart', 'doughnut', Object.keys(statusMap), Object.values(statusMap),
    ['#ff5630', '#ff8b00', '#0052cc', '#36b37e']);

  const prioMap = count(tickets, 'priority');
  makeChart('rptPriorityChart', 'doughnut', Object.keys(prioMap), Object.values(prioMap),
    ['#d32f2f', '#f57c00', '#0052cc', '#388e3c']);

  const typeMap = count(tickets, 'type');
  makeChart('rptTypeChart', 'doughnut', Object.keys(typeMap), Object.values(typeMap));

  const assigneeMap = {};
  tickets.forEach(t => {
    const name = t.assignee_name || t.assignee_initials || 'Unassigned';
    assigneeMap[name] = (assigneeMap[name] || 0) + 1;
  });
  makeChart('rptAssigneeChart', 'bar', Object.keys(assigneeMap), Object.values(assigneeMap));

  // Escalated + overdue list
  const atRisk = tickets.filter(t => t.is_escalated || (t.due_date && new Date(t.due_date) < new Date() && t.status !== 'closed'));
  const listEl = document.getElementById('rptEscalatedList');
  listEl.innerHTML = atRisk.length
    ? atRisk.map(t => `
        <div class="rpt-list-item" onclick="openSidePanel('${t.id}')">
          <span class="list-id">${escHtml(t.id)}</span>
          ${t.is_escalated ? '<span class="escalated-badge"><i class="fas fa-exclamation-triangle"></i> Escalated</span>' : ''}
          ${t.due_date && new Date(t.due_date) < new Date() && t.status !== 'closed' ? '<span class="overdue-chip"><i class="fas fa-clock"></i> Overdue</span>' : ''}
          <span class="rpt-list-title">${escHtml(t.title)}</span>
          <span class="ml-auto">${escHtml(t.assignee_name || t.assignee_initials || 'Unassigned')}</span>
        </div>`).join('')
    : '<p style="color:#5e6c84;padding:16px">No escalated or overdue tickets. Great work! 🎉</p>';
}

// ── Timeline ──────────────────────────────────────────────────────────────────
async function showTimeline() {
  showPage('timeline');
  if (!currentProjectId) { showNotification('Select a project first.', 'error'); return; }
  const project = projects.find(p => p.id === currentProjectId);
  if (project) document.getElementById('timelineProjectName').textContent = `Project: ${project.name}`;

  try {
    const tickets = await api(`/tickets?project_id=${currentProjectId}`);
    renderTimeline(tickets);
  } catch (err) { showNotification(err.message, 'error'); }
}

function renderTimeline(tickets) {
  const statusF = document.getElementById('timelineStatusFilter')?.value || '';
  const assigneeF = document.getElementById('timelineAssigneeFilter')?.value || '';

  let filtered = tickets.filter(t => {
    if (!t.due_date) return false;
    if (statusF && t.status !== statusF) return false;
    if (assigneeF && t.assignee_initials !== assigneeF) return false;
    return true;
  });
  filtered.sort((a, b) => new Date(a.due_date) - new Date(b.due_date));

  const container = document.getElementById('timelineContainer');
  const emptyEl = document.getElementById('timelineEmpty');

  if (!filtered.length) { container.innerHTML = ''; emptyEl.style.display = 'block'; return; }
  emptyEl.style.display = 'none';

  const now = new Date();
  const statusColors = { new: '#0052cc', active: '#ff8b00', resolved: '#36b37e', closed: '#6554c0' };

  // Group by month
  const groups = {};
  filtered.forEach(t => {
    const d = new Date(t.due_date);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleString('en-PH', { month: 'long', year: 'numeric' });
    if (!groups[key]) groups[key] = { label, tickets: [] };
    groups[key].tickets.push(t);
  });

  container.innerHTML = Object.values(groups).map(g => `
    <div class="timeline-month">
      <div class="timeline-month-label"><i class="fas fa-calendar"></i> ${escHtml(g.label)}</div>
      ${g.tickets.map(t => {
    const d = new Date(t.due_date);
    const isOverdue = d < now && t.status !== 'closed';
    const color = statusColors[t.status] || '#999';
    return `<div class="timeline-item${isOverdue ? ' overdue' : ''}" onclick="openSidePanel('${t.id}')">
          <div class="timeline-dot" style="background:${color}"></div>
          <div class="timeline-date">${d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}</div>
          <div class="timeline-content">
            <div class="timeline-ticket-id">${escHtml(t.id)}</div>
            <div class="timeline-ticket-title">${escHtml(t.title)}</div>
            <div class="timeline-meta">
              <span class="status-pill" style="background:${color};font-size:10px">${t.status}</span>
              <span style="font-size:11px;color:#5e6c84">${escHtml(t.assignee_name || t.assignee_initials || 'Unassigned')}</span>
              ${isOverdue ? '<span class="overdue-chip"><i class="fas fa-exclamation-circle"></i> Overdue</span>' : ''}
            </div>
          </div>
        </div>`;
  }).join('')}
    </div>`).join('');
}

// ── Advanced Search ────────────────────────────────────────────────────────────
async function runAdvancedSearch(e) {
  e.preventDefault();
  const kw = document.getElementById('searchKeyword').value.trim().toLowerCase();
  const status = document.getElementById('searchStatus').value;
  const priority = document.getElementById('searchPriority').value;
  const type = document.getElementById('searchType').value;
  const assignee = document.getElementById('searchAssignee').value;
  const label = document.getElementById('searchLabels').value.trim().toLowerCase();
  const escalated = document.getElementById('searchEscalated').value;

  try {
    // Search across ALL projects if no project selected, else current project
    let allTickets = [];
    if (currentProjectId) {
      allTickets = await api(`/tickets?project_id=${currentProjectId}`);
    } else {
      for (const p of projects) {
        const t = await api(`/tickets?project_id=${p.id}`);
        allTickets.push(...t);
      }
    }

    const results = allTickets.filter(t => {
      if (status && t.status !== status) return false;
      if (priority && t.priority !== priority) return false;
      if (type && t.type !== type) return false;
      if (assignee && t.assignee_initials !== assignee) return false;
      if (escalated && !t.is_escalated) return false;
      if (label && !(t.labels || '').toLowerCase().includes(label)) return false;
      if (kw && !t.title.toLowerCase().includes(kw) && !(t.description || '').toLowerCase().includes(kw)) return false;
      return true;
    });

    const resultsEl = document.getElementById('searchResults');
    const countEl = document.getElementById('searchResultCount');
    const listEl = document.getElementById('searchResultsList');
    resultsEl.style.display = 'block';
    countEl.innerHTML = `<strong>${results.length}</strong> result${results.length !== 1 ? 's' : ''} found`;

    const statusColors = { backlog: '#ff5630', todo: '#ff8b00', inprogress: '#0052cc', done: '#36b37e' };
    listEl.innerHTML = results.length
      ? results.map(t => `
          <div class="search-result-item" onclick="handleSearchResultClick('${t.id}','${t.project_id || currentProjectId}')">
            <span class="list-id">${escHtml(t.id)}</span>
            ${t.is_escalated ? '<i class="fas fa-exclamation-triangle" style="color:#ff5630" title="Escalated"></i>' : ''}
            <span class="search-title">${escHtml(t.title)}</span>
            <div style="margin-left:auto;display:flex;gap:6px;flex-shrink:0">
              <span class="status-pill" style="background:${statusColors[t.status] || '#999'};font-size:11px">${t.status}</span>
              <span class="priority-pill" style="font-size:11px">${t.priority}</span>
            </div>
          </div>`).join('')
      : '<p style="color:#5e6c84;padding:16px;text-align:center">No tickets match your search criteria.</p>';
  } catch (err) { showNotification(err.message, 'error'); }
}

async function handleSearchResultClick(ticketId, projectId) {
  closeSearchModal();
  if (projectId && projectId !== currentProjectId) {
    currentProjectId = projectId;
    sessionStorage.setItem('currentProjectId', projectId);
    await loadBoard();
    renderProjectsList();
  }
  showPage('board');
  openSidePanel(ticketId);
}

// ── Page navigation ────────────────────────────────────────────────────────────
function showPage(page) {
  const pages = { projects: projectsPage, board: boardPage, reports: reportsPage, timeline: timelinePage };
  Object.entries(pages).forEach(([k, el]) => { if (el) el.style.display = k === page ? 'block' : 'none'; });

  // Update nav active states
  [projectsLink, boardLink, reportsLink, issuesLink].forEach(el => el?.classList.remove('active'));
  if (page === 'projects') projectsLink?.classList.add('active');
  if (page === 'board') boardLink?.classList.add('active');
  if (page === 'reports') reportsLink?.classList.add('active');
  if (page === 'timeline') reportsLink?.classList.add('active');
}

// ── Event Listeners ────────────────────────────────────────────────────────────
function setupEventListeners() {
  // Nav
  projectsLink?.addEventListener('click', e => { e.preventDefault(); showPage('projects'); });
  boardLink?.addEventListener('click', e => { e.preventDefault(); if (currentProjectId) showPage('board'); else showNotification('Select a project first.', 'error'); });
  reportsLink?.addEventListener('click', e => { e.preventDefault(); showReports(); });
  issuesLink?.addEventListener('click', e => { e.preventDefault(); openSearchModal(); });

  // Sidebar views
  document.getElementById('boardViewLink')?.addEventListener('click', e => { e.preventDefault(); if (!currentProjectId) return; showPage('board'); switchView('board'); });
  document.getElementById('listViewLink')?.addEventListener('click', e => { e.preventDefault(); if (!currentProjectId) return; showPage('board'); switchView('list'); });
  document.getElementById('reportsViewLink')?.addEventListener('click', e => { e.preventDefault(); showReports(); });
  document.getElementById('timelineViewLink')?.addEventListener('click', e => { e.preventDefault(); showTimeline(); });

  // Sidebar filters
  document.getElementById('myIssuesFilter')?.addEventListener('click', async e => {
    e.preventDefault();
    await applyFilter(`My Open Issues (${currentUser.full_name})`, tickets =>
      tickets.filter(t => t.assignee_initials === currentUser.initials && t.status !== 'done'));
  });
  document.getElementById('createdByMeFilter')?.addEventListener('click', async e => {
    e.preventDefault();
    await applyFilter(`Created by ${currentUser.full_name}`, tickets =>
      tickets.filter(t => t.reporter_initials === currentUser.initials));
  });
  document.getElementById('recentFilter')?.addEventListener('click', async e => {
    e.preventDefault();
    await applyFilter('Recently Updated', tickets =>
      [...tickets].sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0)).slice(0, 20));
  });
  document.getElementById('searchFilter')?.addEventListener('click', e => { e.preventDefault(); openSearchModal(); });

  // Inline filter bar
  document.getElementById('clearFilterBtn')?.addEventListener('click', () => { clearFilter(); });
  document.getElementById('filterBtn')?.addEventListener('click', openSearchModal);

  // View toggles
  toggleBoardBtn?.addEventListener('click', () => switchView('board'));
  toggleListBtn?.addEventListener('click', () => switchView('list'));

  // List view live search/filter
  document.getElementById('listSearch')?.addEventListener('input', () => renderListView(boardTickets));
  document.getElementById('listStatusFilter')?.addEventListener('change', () => renderListView(boardTickets));
  document.getElementById('listPriorityFilter')?.addEventListener('change', () => renderListView(boardTickets));

  // List view column sort
  document.querySelectorAll('#listViewTable th[data-sort]').forEach(th => {
    th.style.cursor = 'pointer';
    th.addEventListener('click', () => {
      const field = th.dataset.sort;
      if (listSortField === field) listSortAsc = !listSortAsc;
      else { listSortField = field; listSortAsc = true; }
      renderListView(boardTickets);
    });
  });

  // Timeline filters
  document.getElementById('timelineStatusFilter')?.addEventListener('change', async () => {
    const tickets = await api(`/tickets?project_id=${currentProjectId}`);
    renderTimeline(tickets);
  });
  document.getElementById('timelineAssigneeFilter')?.addEventListener('change', async () => {
    const tickets = await api(`/tickets?project_id=${currentProjectId}`);
    renderTimeline(tickets);
  });

  // Ticket modal
  createTicketBtn?.addEventListener('click', openTicketModal);
  document.getElementById('closeModal')?.addEventListener('click', closeTicketModal);
  document.getElementById('cancelBtn')?.addEventListener('click', closeTicketModal);
  document.getElementById('saveTicketBtn')?.addEventListener('click', handleTicketFormSubmit);
  modalOverlay?.addEventListener('click', e => { if (e.target === modalOverlay) closeTicketModal(); });

  // Project modal
  createProjectBtn?.addEventListener('click', openProjectModal);
  document.getElementById('createFirstProjectBtn')?.addEventListener('click', openProjectModal);
  document.getElementById('closeProjectModal')?.addEventListener('click', closeProjectModal);
  document.getElementById('cancelProjectBtn')?.addEventListener('click', closeProjectModal);
  document.getElementById('saveProjectBtn')?.addEventListener('click', handleProjectFormSubmit);
  projectModalOverlay?.addEventListener('click', e => { if (e.target === projectModalOverlay) closeProjectModal(); });

  // Search modal
  document.getElementById('closeSearchModal')?.addEventListener('click', closeSearchModal);
  document.getElementById('cancelSearchBtn')?.addEventListener('click', closeSearchModal);
  document.getElementById('runSearchBtn')?.addEventListener('click', runAdvancedSearch);
  searchModalOverlay?.addEventListener('click', e => { if (e.target === searchModalOverlay) closeSearchModal(); });
  document.getElementById('searchKeyword')?.addEventListener('keydown', e => { if (e.key === 'Enter') runAdvancedSearch(e); });

  // Escape key
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (searchModalOverlay?.style.display === 'flex') { closeSearchModal(); return; }
    if (modalOverlay?.style.display === 'flex') { closeTicketModal(); return; }
    if (projectModalOverlay?.style.display === 'flex') { closeProjectModal(); return; }
    if (document.getElementById('sidePanel')?.classList.contains('open')) { closeSidePanel(); return; }
  });
}

// ── Notifications ─────────────────────────────────────────────────────────────
function showNotification(message, type = 'success') {
  const existing = document.querySelectorAll('.notification');
  const topOffset = 20 + existing.length * 64;
  const n = document.createElement('div');
  n.className = 'notification';
  n.style.cssText = `position:fixed;top:${topOffset}px;right:20px;background:${type === 'error' ? '#ff5630' : '#36b37e'};
    color:white;padding:12px 20px;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,.2);
    z-index:10000;animation:slideIn 0.3s ease;max-width:320px;font-size:14px;display:flex;align-items:center;gap:8px;`;
  n.innerHTML = `<i class="fas ${type === 'error' ? 'fa-exclamation-circle' : 'fa-check-circle'}"></i>${escHtml(message)}`;
  document.body.appendChild(n);
  setTimeout(() => { n.style.animation = 'slideOut 0.3s ease'; setTimeout(() => n.remove(), 300); }, 3500);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function escHtml(str) {
  const d = document.createElement('div');
  d.textContent = str ?? '';
  return d.innerHTML.replace(/'/g, '&#39;');
}
function fmtDate(iso) {
  if (!iso) return '';
  try {
    // SQLite format "YYYY-MM-DD HH:MM:SS" is naive UTC. 
    // If it lacks 'T' or 'Z', treat it as UTC by appending 'Z'.
    let utc = iso;
    if (!iso.includes('Z') && !iso.includes('+')) {
      utc = iso.includes('T') ? iso + 'Z' : iso.replace(' ', 'T') + 'Z';
    }
    return new Date(utc).toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  } catch { return iso; }
}

// ── Styles ────────────────────────────────────────────────────────────────────
function injectStyles() {
  if (document.getElementById('appExtraStyles')) return;
  const s = document.createElement('style');
  s.id = 'appExtraStyles';
  s.textContent = `
  @keyframes slideIn{from{transform:translateX(100%);opacity:0}to{transform:translateX(0);opacity:1}}
  @keyframes slideOut{from{transform:translateX(0);opacity:1}to{transform:translateX(100%);opacity:0}}

  /* Filter bar */
  .filter-bar{display:flex;align-items:center;gap:12px;padding:8px 20px;background:#fff8e1;
    border:1px solid #ffe082;border-radius:6px;margin-bottom:16px;font-size:13px;color:#5e6c84;}
  .filter-bar span{flex:1}

  /* View toggle */
  .view-toggle-group{display:flex;border:1px solid #dfe1e6;border-radius:6px;overflow:hidden;}
  .view-toggle-btn{padding:7px 14px;background:white;border:none;cursor:pointer;font-size:13px;
    color:#5e6c84;display:flex;align-items:center;gap:6px;transition:all .2s;}
  .view-toggle-btn.active{background:#0052cc;color:white;}
  .view-toggle-btn:hover:not(.active){background:#f4f5f7;}

  /* List view */
  .list-toolbar{display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap;}
  .list-view-table-wrap{overflow-x:auto;border:1px solid #dfe1e6;border-radius:8px;}
  .list-view-table{width:100%;border-collapse:collapse;background:white;font-size:13px;}
  .list-view-table thead tr{background:#f4f5f7;}
  .list-view-table th{padding:10px 14px;text-align:left;font-weight:700;color:#5e6c84;
    font-size:11px;text-transform:uppercase;letter-spacing:.5px;cursor:pointer;user-select:none;white-space:nowrap;}
  .list-view-table th:hover{background:#e3e5e8;}
  .list-row{transition:background .15s;cursor:pointer;border-bottom:1px solid #f4f5f7;}
  .list-row:hover{background:#f4f5f7;}
  .list-row td{padding:10px 14px;vertical-align:middle;}
  .list-id{font-size:11px;font-weight:700;color:#0052cc;white-space:nowrap;}
  .list-title-cell{max-width:320px;}
  .list-title-text{font-weight:500;color:#172b4d;}
  .status-pill{display:inline-block;padding:2px 8px;border-radius:10px;color:white;font-size:11px;font-weight:600;text-transform:uppercase;}
  .priority-pill{display:inline-block;padding:2px 8px;border-radius:10px;background:#dfe1e6;color:#172b4d;font-size:11px;font-weight:600;text-transform:uppercase;}
  .type-pill{display:inline-block;padding:2px 8px;border-radius:4px;background:#e3f2fd;color:#0052cc;font-size:11px;font-weight:600;}

  /* Reports */
  .reports-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:24px;}
  .report-card{background:white;border:1px solid #dfe1e6;border-radius:10px;padding:20px;}
  .report-card h3{margin:0 0 16px;font-size:15px;color:#172b4d;}
  .rpt-list{display:flex;flex-direction:column;gap:8px;}
  .rpt-list-item{display:flex;align-items:center;gap:10px;padding:10px 14px;border:1px solid #dfe1e6;
    border-radius:6px;cursor:pointer;transition:background .15s;font-size:13px;}
  .rpt-list-item:hover{background:#f4f5f7;}
  .rpt-list-title{flex:1;font-weight:500;}
  .overdue-chip{background:#ff5630;color:white;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;}

  /* Timeline */
  .timeline-toolbar{display:flex;gap:12px;margin-bottom:24px;}
  .timeline-container{display:flex;flex-direction:column;gap:0;}
  .timeline-month{margin-bottom:32px;}
  .timeline-month-label{font-size:14px;font-weight:700;color:#172b4d;margin-bottom:16px;
    padding-bottom:8px;border-bottom:2px solid #dfe1e6;display:flex;align-items:center;gap:8px;}
  .timeline-item{display:flex;align-items:flex-start;gap:16px;padding:12px 16px;
    border-left:3px solid #dfe1e6;margin-left:12px;cursor:pointer;transition:background .15s;border-radius:0 6px 6px 0;}
  .timeline-item:hover{background:#f4f5f7;}
  .timeline-item.overdue{border-left-color:#ff5630;background:#fff5f3;}
  .timeline-dot{width:12px;height:12px;border-radius:50%;flex-shrink:0;margin-top:2px;margin-left:-18px;}
  .timeline-date{font-size:13px;font-weight:700;color:#5e6c84;width:80px;flex-shrink:0;}
  .timeline-content{flex:1;}
  .timeline-ticket-id{font-size:11px;font-weight:700;color:#0052cc;margin-bottom:2px;}
  .timeline-ticket-title{font-size:14px;color:#172b4d;margin-bottom:4px;}
  .timeline-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}

  /* Search */
  .search-results{max-height:360px;overflow-y:auto;margin-top:16px;border:1px solid #dfe1e6;border-radius:6px;}
  .search-results-header{padding:8px 14px;background:#f4f5f7;font-size:13px;border-bottom:1px solid #dfe1e6;color:#5e6c84;}
  .search-result-item{display:flex;align-items:center;gap:10px;padding:10px 14px;
    border-bottom:1px solid #f4f5f7;cursor:pointer;transition:background .15s;font-size:13px;}
  .search-result-item:hover{background:#f4f5f7;}
  .search-result-item:last-child{border-bottom:none;}
  .search-title{flex:1;font-weight:500;color:#172b4d;}

  /* Project cards */
  .project-card{background:white;border:1px solid #dfe1e6;border-radius:10px;padding:20px;transition:box-shadow .2s;}
  .project-card:hover{box-shadow:0 4px 16px rgba(0,0,0,.1);}
  .project-card-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;}
  .project-card-header h3{margin:0;font-size:16px;}
  .project-key{background:#0052cc;color:white;padding:3px 8px;border-radius:4px;font-size:12px;font-weight:700;}
  .project-card-body p{color:#5e6c84;font-size:14px;margin-bottom:10px;}
  .project-stats{display:flex;gap:16px;font-size:13px;color:#5e6c84;}
  .project-card-footer{display:flex;gap:8px;margin-top:16px;border-top:1px solid #dfe1e6;padding-top:16px;}
  .btn-small{padding:5px 10px;font-size:12px;}

  /* Ticket extras */
  .escalated-ticket{border-left-color:#ff5630!important;background:#fff5f3!important;}
  .escalated-badge{background:#ff5630;color:white;font-size:11px;padding:2px 8px;border-radius:3px;margin:4px 0;display:inline-block;}
  .ticket-labels{display:flex;flex-wrap:wrap;gap:4px;margin:4px 0;}
  .label-tag{background:#e3f2fd;color:#0052cc;font-size:11px;padding:2px 7px;border-radius:10px;}
  .story-points-badge{background:#e8f5e9;color:#388e3c;font-size:11px;padding:2px 7px;border-radius:10px;font-weight:700;}
  .subtask-count,.comment-count{font-size:11px;color:#5e6c84;display:flex;align-items:center;gap:3px;}
  .overdue-badge{color:#ff5630;font-size:14px;}
  .drag-over{background:rgba(0,82,204,.08)!important;border:2px dashed #0052cc!important;border-radius:6px;}
  .dragging{opacity:.4;}

  /* Sidebar active */
  .sidebar-menu a.active{color:#0052cc!important;background:rgba(0,82,204,.08);border-radius:4px;}

  /* Side panel */
  .side-panel{position:fixed;top:0;right:0;bottom:0;left:0;z-index:2000;pointer-events:none;}
  .side-panel.open{pointer-events:all;}
  .side-panel-overlay{position:absolute;inset:0;background:rgba(0,0,0,.35);opacity:0;transition:opacity .3s;}
  .side-panel.open .side-panel-overlay{opacity:1;}
  .side-panel-content{position:absolute;top:0;right:0;bottom:0;width:680px;max-width:95vw;
    background:white;box-shadow:-4px 0 30px rgba(0,0,0,.15);transform:translateX(100%);transition:transform .3s ease;
    display:flex;flex-direction:column;overflow:hidden;}
  .side-panel.open .side-panel-content{transform:translateX(0);}
  .side-panel-header{padding:14px 20px;border-bottom:2px solid #dfe1e6;display:flex;justify-content:space-between;align-items:center;background:#f4f5f7;flex-shrink:0;}
  .sp-ticket-id{font-size:13px;font-weight:700;color:#0052cc;}
  .sp-header-actions{display:flex;gap:8px;}
  .side-panel-body{flex:1;overflow-y:auto;padding:24px;}
  .sp-title{font-size:20px;font-weight:700;color:#172b4d;outline:none;margin-bottom:20px;border:2px solid transparent;border-radius:4px;padding:4px 6px;cursor:text;line-height:1.3;}
  .sp-title:focus{border-color:#0052cc;}
  .sp-section{margin-bottom:24px;}
  .sp-section>label{display:block;font-size:11px;font-weight:700;text-transform:uppercase;color:#5e6c84;letter-spacing:.6px;margin-bottom:8px;}
  .sp-meta-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px;}
  .sp-meta-item>label{display:block;font-size:11px;font-weight:700;text-transform:uppercase;color:#5e6c84;letter-spacing:.5px;margin-bottom:5px;}
  .sp-text{font-size:14px;color:#172b4d;padding:6px 0;}
  .sp-select,.sp-input{width:100%;padding:8px 10px;border:1px solid #dfe1e6;border-radius:4px;font-size:13px;color:#172b4d;background:white;}
  .sp-select:focus,.sp-input:focus{outline:none;border-color:#0052cc;}
  .sp-textarea{width:100%;padding:10px;border:1px solid #dfe1e6;border-radius:4px;font-size:13px;min-height:80px;resize:vertical;font-family:inherit;color:#172b4d;}
  .sp-textarea:focus{outline:none;border-color:#0052cc;}
  .status-transition-btns{display:flex;gap:8px;flex-wrap:wrap;}
  .status-btn{padding:7px 14px;border:2px solid #dfe1e6;border-radius:20px;background:white;cursor:pointer;font-size:13px;font-weight:600;transition:all .2s;display:flex;align-items:center;gap:6px;}
  .status-btn:hover{border-color:#0052cc;color:#0052cc;}
  .status-btn.backlog.active{border-color:#ff5630;background:#ff5630;color:white;}
  .status-btn.todo.active{border-color:#ff8b00;background:#ff8b00;color:white;}
  .status-btn.inprogress.active{border-color:#0052cc;background:#0052cc;color:white;}
  .status-btn.done.active{border-color:#36b37e;background:#36b37e;color:white;}
  .sp-watchers{display:flex;flex-wrap:wrap;gap:6px;}
  .watcher-chip{background:#f4f5f7;border:1px solid #dfe1e6;border-radius:12px;padding:4px 10px;font-size:12px;}
  .subtask-item{display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #dfe1e6;font-size:13px;}
  .subtask-id{margin-left:auto;font-size:11px;color:#5e6c84;}
  .done-text{text-decoration:line-through;color:#5e6c84;}
  .sp-comment{margin-bottom:14px;}
  .sp-comment-meta{display:flex;align-items:center;gap:8px;margin-bottom:5px;font-size:13px;}
  .sp-timestamp{font-size:11px;color:#5e6c84;margin-left:4px;}
  .sp-comment-body{font-size:13px;line-height:1.5;background:#f4f5f7;padding:10px 12px;border-radius:4px;white-space:pre-wrap;}
  .sp-audit-log{border:1px solid #dfe1e6;border-radius:6px;overflow:hidden;}
  .audit-entry{padding:10px 14px;border-bottom:1px solid #dfe1e6;}
  .audit-entry:last-child{border-bottom:none;}
  .audit-timestamp{font-size:11px;color:#5e6c84;margin-bottom:4px;font-family:monospace;}
  .audit-body{display:flex;align-items:center;gap:8px;font-size:13px;}
  .sp-avatar-mini{width:28px;height:28px;border-radius:50%;background:#0052cc;color:white;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0;}
  .sp-avatar-mini.small{width:22px;height:22px;font-size:10px;}
  .btn-icon{background:none;border:none;color:#5e6c84;cursor:pointer;padding:4px;border-radius:4px;transition:all .2s;display:flex;align-items:center;justify-content:center;}
  .btn-icon:hover{background:rgba(9,30,66,.08);color:#0052cc;}
  .sp-comment .btn-icon,.audit-entry .btn-icon{opacity:0.4; transition: opacity 0.2s;}
  .sp-comment:hover .btn-icon,.audit-entry:hover .btn-icon{opacity:1;}
  .sp-comment-body:hover, .audit-note:hover { background: rgba(9,30,66,0.04); border-radius: 4px; }
  `;

  document.head.appendChild(s);
}

// \u2500\u2500 Notifications Panel \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

function setupNotifications() {
  const bellBtn = document.getElementById('notifBellBtn');
  const dropdown = document.getElementById('notifDropdown');
  if (!bellBtn || !dropdown) return;
  bellBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (dropdown.classList.contains('open')) {
      dropdown.classList.remove('open');
    } else {
      await loadNotifications();
      dropdown.classList.add('open');
    }
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.notif-wrapper')) dropdown.classList.remove('open');
  });
}

async function loadNotifications() {
  const dropdown = document.getElementById('notifDropdown');
  const badge = document.getElementById('notifBadge');
  if (!dropdown) return;
  try {
    const items = await api('/tickets/notifications');
    if (items.length > 0) {
      badge.textContent = items.length;
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
    const statusColors = { new: '#0052cc', active: '#ff8b00', resolved: '#36b37e', closed: '#6554c0' };
    const statusLabels = { new: 'New', active: 'Active', resolved: 'Resolved', closed: 'Closed' };
    const priorityColors = { critical: '#b71c1c', high: '#d32f2f', medium: '#f57c00', low: '#388e3c' };
    if (items.length === 0) {
      dropdown.innerHTML = `
        <div class="notif-header"><i class="fas fa-bell"></i> Watched Incidents</div>
        <div class="notif-empty"><i class="fas fa-eye-slash"></i><p>You aren't watching any incidents yet.</p></div>`;
      return;
    }
    dropdown.innerHTML = `
      <div class="notif-header"><i class="fas fa-bell"></i> Watched Incidents <span class="notif-count">${items.length}</span></div>
      ${items.map(n => `
        <div class="notif-item" data-id="${escHtml(n.id)}">
          <div class="notif-item-top">
            <span class="notif-id">${escHtml(n.id)}</span>
            <span class="notif-status-pill" style="background:${statusColors[n.status] || '#999'}">${statusLabels[n.status] || n.status}</span>
            <span class="notif-priority" style="color:${priorityColors[n.priority] || '#999'};font-weight:600;font-size:11px;text-transform:uppercase">${n.priority}</span>
            ${n.is_escalated ? '<span class="notif-escalated" title="Escalated"><i class="fas fa-exclamation-triangle"></i></span>' : ''}
          </div>
          <div class="notif-title">${escHtml(n.title)}</div>
          ${n.latest_note ? `<div class="notif-activity"><i class="fas fa-clock"></i> ${fmtDate(n.latest_at)} &mdash; ${escHtml(n.latest_note)}</div>` : ''}
        </div>`).join('')}`;
    dropdown.querySelectorAll('.notif-item').forEach(el => {
      el.addEventListener('click', () => {
        document.getElementById('notifDropdown').classList.remove('open');
        openSidePanel(el.dataset.id);
      });
    });
  } catch (err) {
    dropdown.innerHTML = `<div class="notif-header">Notifications</div><div class="notif-empty"><p>Failed to load notifications.</p></div>`;
  }
}

// \u2500\u2500 Bootstrap \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
document.addEventListener('DOMContentLoaded', initializeApp);

