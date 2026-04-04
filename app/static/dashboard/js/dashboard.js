/* ═══════════════════════════════════════════════════════
   DASHBOARD JS — LogiPlanner
   Loads real data from API, team-aware, dynamic
   Interactive calendar with task management
   v2: time ranges, location, @mentions, color tags, RAG sync
   ═══════════════════════════════════════════════════════ */

(function () {
    'use strict';

    const API = '/api/v1';
    const token = localStorage.getItem('access_token');
    if (!token) return;

    const headers = { 'Authorization': 'Bearer ' + token };
    const jsonHeaders = { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };

    // ── State ──
    let currentTeamId = null;
    let teams = [];
    let userName = '';

    // Calendar state
    let calView = 'month';
    let calDate = new Date();
    let calTasks = [];           // All tasks for current visible range
    let calActivityDays = {};    // { 'YYYY-MM-DD': { docs, chats } }
    let selectedDate = null;     // Currently selected date key 'YYYY-MM-DD'

    // Team members (for @mention autocomplete)
    let teamMembers = [];
    let taggedUserIds = [];      // Currently tagged user IDs in the modal
    let selectedColorTag = '';   // Currently selected color hex

    // AI suggestions state
    let aiSuggestions = [];
    let aiSuggestionsLoading = false;
    let seenSuggestionTitles = new Set(); // tracks titles shown so far to avoid re-showing

    // ── Helpers ──
    async function api(path, opts) {
        const res = await fetch(API + path, { headers, ...opts });
        if (res.status === 401) {
            localStorage.removeItem('access_token');
            window.location.href = '/login';
            return null;
        }
        if (!res.ok) return null;
        if (res.status === 204) return true;
        return res.json();
    }

    async function apiJson(path, method, body) {
        const res = await fetch(API + path, {
            method,
            headers: jsonHeaders,
            body: JSON.stringify(body),
        });
        if (res.status === 401) {
            localStorage.removeItem('access_token');
            window.location.href = '/login';
            return null;
        }
        if (!res.ok) {
            const err = await res.json().catch(() => null);
            return { _error: true, detail: err?.detail || 'Request failed' };
        }
        if (res.status === 204) return true;
        return res.json();
    }

    function getGreeting() {
        const h = new Date().getHours();
        if (h < 12) return 'Good morning';
        if (h < 17) return 'Good afternoon';
        return 'Good evening';
    }

    function getInitials(name) {
        if (!name) return 'U';
        return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
    }

    function dateKey(d) {
        const yr = d.getFullYear();
        const mo = String(d.getMonth() + 1).padStart(2, '0');
        const dy = String(d.getDate()).padStart(2, '0');
        return `${yr}-${mo}-${dy}`;
    }

    function formatDateLabel(key) {
        const d = new Date(key + 'T12:00:00');
        return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    }

    /** Check if a task spans a given date (multi-day support) */
    function taskSpansDate(task, key) {
        const startKey = task.start_datetime ? task.start_datetime.slice(0, 10) : task.task_date;
        const endKey = task.end_datetime ? task.end_datetime.slice(0, 10) : task.task_date;
        return key >= startKey && key <= endKey;
    }

    function tasksForDate(key) {
        return calTasks.filter(t => taskSpansDate(t, key));
    }

    function priorityColor(p) {
        if (p === 'high') return '#ef4444';
        if (p === 'low') return '#06d6a0';
        return '#6366f1';
    }

    function priorityLabel(p) {
        return p.charAt(0).toUpperCase() + p.slice(1);
    }

    function taskTypeIcon(t) {
        const icons = { meeting: '📅', deadline: '⏰', milestone: '🏁', action_item: '⚡', regular: '📋' };
        return icons[t] || '📋';
    }

    function taskTypeLabel(t) {
        const labels = { meeting: 'Meeting', deadline: 'Deadline', milestone: 'Milestone', action_item: 'Action Item', regular: 'Regular' };
        return labels[t] || 'Regular';
    }

    function escHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function formatTime(isoStr) {
        if (!isoStr) return '';
        const d = new Date(isoStr);
        return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    }

    function formatDateTimeShort(isoStr) {
        if (!isoStr) return '';
        const d = new Date(isoStr);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + formatTime(isoStr);
    }

    function toLocalDatetimeValue(isoStr) {
        if (!isoStr) return '';
        const d = new Date(isoStr);
        const off = d.getTimezoneOffset();
        const local = new Date(d.getTime() - off * 60000);
        return local.toISOString().slice(0, 16);
    }

    // ── Initialize ──
    async function init() {
        const [profile, teamsData] = await Promise.all([
            api('/profile-status'),
            api('/user-teams'),
        ]);

        if (!profile || !teamsData) return;

        if (profile.next_step === 'complete_profile') {
            window.location.href = '/profile';
            return;
        }
        if (profile.next_step === 'team_selection') {
            window.location.href = '/team-select';
            return;
        }

        userName = profile.full_name || '';
        teams = teamsData.teams || [];

        const greetEl = document.getElementById('greetingText');
        if (greetEl) {
            greetEl.innerHTML = getGreeting() + (userName ? ', <span>' + escHtml(userName.split(' ')[0]) + '</span>' : '');
        }

        const avatarEl = document.getElementById('avatarInitials');
        if (avatarEl) avatarEl.textContent = getInitials(userName);

        const teamSelect = document.getElementById('teamSelect');
        if (teamSelect && teams.length > 0) {
            const savedTeam = localStorage.getItem('selected_team_id');
            teamSelect.innerHTML = teams.map(t =>
                '<option value="' + t.id + '"' + (savedTeam && parseInt(savedTeam) === t.id ? ' selected' : '') + '>' + escHtml(t.name) + '</option>'
            ).join('');
            currentTeamId = savedTeam && teams.some(t => t.id === parseInt(savedTeam))
                ? parseInt(savedTeam)
                : teams[0].id;
            teamSelect.value = currentTeamId;

            teamSelect.addEventListener('change', function () {
                currentTeamId = parseInt(this.value);
                localStorage.setItem('selected_team_id', currentTeamId);
                loadTeamData();
            });
        }

        updateWelcomeBanner();
        initCalendarControls();
        initTaskModal();
        initDayPanel();
        initAISuggestionsPanel();
        loadTeamData();
    }

    function updateWelcomeBanner() {
        const team = teams.find(t => t.id === currentTeamId);
        const titleEl = document.getElementById('welcomeTitle');
        const labelEl = document.getElementById('teamLabel');

        if (titleEl && userName) {
            titleEl.innerHTML = 'Welcome back, <em>' + escHtml(userName.split(' ')[0]) + '</em>';
        }
        if (labelEl && team) {
            labelEl.textContent = team.name;
        }
    }

    async function loadTeamData() {
        if (!currentTeamId) return;

        updateWelcomeBanner();

        const [stats, docs, chatHistory, roleData, members] = await Promise.all([
            api('/rag/stats/' + currentTeamId),
            api('/rag/documents/' + currentTeamId),
            api('/rag/chat/history/' + currentTeamId + '?limit=10'),
            api('/rag/my-role/' + currentTeamId),
            api('/calendar/members/' + currentTeamId),
        ]);

        teamMembers = members || [];

        renderStats(stats);

        // Build activity map from docs + chats
        calActivityDays = {};
        if (docs && docs.documents) {
            docs.documents.forEach(doc => {
                if (!doc.created_at) return;
                const key = new Date(doc.created_at).toISOString().slice(0, 10);
                if (!calActivityDays[key]) calActivityDays[key] = { docs: 0, chats: 0 };
                calActivityDays[key].docs++;
            });
        }
        if (chatHistory && chatHistory.messages) {
            chatHistory.messages.filter(m => m.role === 'user').forEach(msg => {
                if (!msg.created_at) return;
                const key = new Date(msg.created_at).toISOString().slice(0, 10);
                if (!calActivityDays[key]) calActivityDays[key] = { docs: 0, chats: 0 };
                calActivityDays[key].chats++;
            });
        }

        await loadCalendarTasks();
        renderTeamInfo(roleData);
        renderGettingStarted(stats, docs);
        loadAISuggestions();
    }

    // ── Stats ──
    function renderStats(stats) {
        const docCount = document.getElementById('statDocuments');
        const chunkCount = document.getElementById('statChunks');
        if (docCount) docCount.textContent = stats ? stats.document_count : 0;
        if (chunkCount) chunkCount.textContent = stats ? stats.total_chunks.toLocaleString() : 0;
    }

    // ══════════════════════════════════════════════
    //  CALENDAR — Task-aware interactive calendar
    // ══════════════════════════════════════════════

    function getVisibleRange() {
        const y = calDate.getFullYear();
        const m = calDate.getMonth();
        if (calView === 'month') {
            const start = new Date(y, m, 1);
            start.setDate(start.getDate() - start.getDay());
            const end = new Date(y, m + 1, 0);
            end.setDate(end.getDate() + (6 - end.getDay()));
            return { start, end };
        } else if (calView === 'week') {
            const start = new Date(calDate);
            start.setDate(start.getDate() - start.getDay());
            const end = new Date(start);
            end.setDate(end.getDate() + 6);
            return { start, end };
        } else {
            return { start: new Date(calDate), end: new Date(calDate) };
        }
    }

    async function loadCalendarTasks() {
        if (!currentTeamId) return;
        const { start, end } = getVisibleRange();
        const result = await api(
            '/calendar/tasks/' + currentTeamId +
            '?start_date=' + dateKey(start) +
            '&end_date=' + dateKey(end)
        );
        calTasks = result && result.tasks ? result.tasks : [];
        drawCalendar();
    }

    function initCalendarControls() {
        const toggle = document.getElementById('calendarViewToggle');
        if (toggle) {
            toggle.querySelectorAll('.calendar-view-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    toggle.querySelectorAll('.calendar-view-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    calView = btn.dataset.view;
                    loadCalendarTasks();
                });
            });
        }

        const prevBtn = document.getElementById('calPrev');
        const nextBtn = document.getElementById('calNext');
        const todayBtn = document.getElementById('calToday');

        if (prevBtn) prevBtn.addEventListener('click', () => { navCalendar(-1); });
        if (nextBtn) nextBtn.addEventListener('click', () => { navCalendar(1); });
        if (todayBtn) todayBtn.addEventListener('click', () => {
            calDate = new Date();
            loadCalendarTasks();
        });
    }

    function navCalendar(dir) {
        if (calView === 'month') {
            calDate.setMonth(calDate.getMonth() + dir);
        } else if (calView === 'week') {
            calDate.setDate(calDate.getDate() + dir * 7);
        } else {
            calDate.setDate(calDate.getDate() + dir);
        }
        loadCalendarTasks();
    }

    function drawCalendar() {
        const grid = document.getElementById('calendarGrid');
        const label = document.getElementById('calLabel');
        if (!grid || !label) return;

        const today = new Date();
        const todayStr = dateKey(today);

        if (calView === 'month') {
            drawMonthView(grid, label, todayStr);
        } else if (calView === 'week') {
            drawWeekView(grid, label, todayStr);
        } else {
            drawDayView(grid, label, todayStr);
        }

        // Attach click handlers for calendar days
        grid.querySelectorAll('[data-date]').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                const clickedDate = el.getAttribute('data-date');
                openDayPanel(clickedDate);
            });
        });

        // Attach add-task buttons on week/day view
        grid.querySelectorAll('.calendar__add-task-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                openTaskModal(btn.dataset.date);
            });
        });

        // Attach toggle-complete checkboxes
        grid.querySelectorAll('.calendar__task-check').forEach(cb => {
            cb.addEventListener('change', (e) => {
                e.stopPropagation();
                toggleTaskComplete(parseInt(cb.dataset.taskId), cb.checked);
            });
        });
    }

    /** Render a color-tag indicator bar */
    function colorTagBar(task) {
        if (!task.color_tag) return '';
        return '<div class="calendar__color-bar" style="background:' + task.color_tag + '"></div>';
    }

    function drawMonthView(grid, label, todayStr) {
        const year = calDate.getFullYear();
        const month = calDate.getMonth();
        label.textContent = calDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

        const firstDay = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const daysInPrev = new Date(year, month, 0).getDate();

        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        let html = '<div class="calendar__weekdays">';
        dayNames.forEach(d => html += '<div class="calendar__weekday">' + d + '</div>');
        html += '</div><div class="calendar__days">';

        // Previous month padding
        for (let i = firstDay - 1; i >= 0; i--) {
            const prevDate = new Date(year, month - 1, daysInPrev - i);
            const key = dateKey(prevDate);
            html += '<div class="calendar__day calendar__day--outside" data-date="' + key + '"><span>' + (daysInPrev - i) + '</span></div>';
        }

        // Current month
        for (let d = 1; d <= daysInMonth; d++) {
            const key = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
            const isToday = key === todayStr;
            const dayTasks = tasksForDate(key);
            const activity = calActivityDays[key];
            let classes = 'calendar__day';
            if (isToday) classes += ' calendar__day--today';
            if (dayTasks.length > 0 || activity) classes += ' calendar__day--has-activity';
            if (key === selectedDate) classes += ' calendar__day--selected';

            let dots = '';
            if (dayTasks.length > 0 || activity) {
                dots = '<div class="calendar__dots">';
                // Show up to 3 color dots from task color_tags, then generic dots
                const colorSet = [...new Set(dayTasks.filter(t => t.color_tag).map(t => t.color_tag))].slice(0, 3);
                colorSet.forEach(c => {
                    dots += '<span class="calendar__dot" style="background:' + c + '"></span>';
                });
                if (dayTasks.length > 0 && colorSet.length === 0) dots += '<span class="calendar__dot calendar__dot--task"></span>';
                if (activity && activity.docs > 0) dots += '<span class="calendar__dot calendar__dot--doc"></span>';
                if (activity && activity.chats > 0) dots += '<span class="calendar__dot calendar__dot--chat"></span>';
                dots += '</div>';
            }

            // Task count badge
            let badge = '';
            if (dayTasks.length > 0) {
                const done = dayTasks.filter(t => t.is_completed).length;
                badge = '<div class="calendar__task-badge">' + done + '/' + dayTasks.length + '</div>';
            }

            html += '<div class="' + classes + '" data-date="' + key + '"><span>' + d + '</span>' + badge + dots + '</div>';
        }

        // Next month padding
        const totalCells = firstDay + daysInMonth;
        const remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
        for (let i = 1; i <= remaining; i++) {
            const nextDate = new Date(year, month + 1, i);
            const key = dateKey(nextDate);
            html += '<div class="calendar__day calendar__day--outside" data-date="' + key + '"><span>' + i + '</span></div>';
        }

        html += '</div>';
        grid.innerHTML = html;
    }

    function drawWeekView(grid, label, todayStr) {
        const startOfWeek = new Date(calDate);
        startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());

        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(endOfWeek.getDate() + 6);

        label.textContent = startOfWeek.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
            ' – ' + endOfWeek.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        let html = '<div class="calendar__week-view">';

        for (let i = 0; i < 7; i++) {
            const day = new Date(startOfWeek);
            day.setDate(day.getDate() + i);
            const key = dateKey(day);
            const isToday = key === todayStr;
            const dayTasks = tasksForDate(key);
            const activity = calActivityDays[key];

            let classes = 'calendar__week-day';
            if (isToday) classes += ' calendar__week-day--today';

            let eventsHtml = '';
            // Show tasks
            dayTasks.forEach(task => {
                const doneClass = task.is_completed ? ' calendar__week-task--done' : '';
                const borderColor = task.color_tag || priorityColor(task.priority);
                const timeStr = task.start_datetime ? formatTime(task.start_datetime) : '';
                eventsHtml += '<div class="calendar__week-task' + doneClass + '" style="border-left-color:' + borderColor + '">'
                    + '<input type="checkbox" class="calendar__task-check" data-task-id="' + task.id + '" ' + (task.is_completed ? 'checked' : '') + '>'
                    + '<span class="calendar__week-task-type">' + taskTypeIcon(task.task_type || 'regular') + '</span>'
                    + '<span class="calendar__week-task-title">' + escHtml(task.title) + '</span>'
                    + (timeStr ? '<span class="calendar__week-task-time">' + timeStr + '</span>' : '')
                    + '</div>';
            });
            // Show activity dots
            if (activity) {
                if (activity.docs > 0) eventsHtml += '<div class="calendar__week-event calendar__week-event--doc">📄 ' + activity.docs + ' doc' + (activity.docs > 1 ? 's' : '') + '</div>';
                if (activity.chats > 0) eventsHtml += '<div class="calendar__week-event calendar__week-event--chat">💬 ' + activity.chats + ' chat' + (activity.chats > 1 ? 's' : '') + '</div>';
            }

            html += '<div class="' + classes + '" data-date="' + key + '">'
                + '<div class="calendar__week-day-header">'
                + '<span class="calendar__week-day-name">' + dayNames[i] + '</span>'
                + '<span class="calendar__week-day-num' + (isToday ? ' calendar__week-day-num--today' : '') + '">' + day.getDate() + '</span>'
                + '</div>'
                + '<div class="calendar__week-day-body">' + (eventsHtml || '<span class="calendar__week-empty">—</span>') + '</div>'
                + '<button class="calendar__add-task-btn" data-date="' + key + '" title="Add task">+</button>'
                + '</div>';
        }

        html += '</div>';
        grid.innerHTML = html;
    }

    function drawDayView(grid, label, todayStr) {
        const key = dateKey(calDate);
        const isToday = key === todayStr;
        const dayName = calDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
        label.textContent = dayName;

        const dayTasks = tasksForDate(key);
        const activity = calActivityDays[key];

        let html = '<div class="calendar__day-view">';
        html += '<div class="calendar__day-view-date' + (isToday ? ' calendar__day-view-date--today' : '') + '">' + calDate.getDate() + '</div>';

        // Tasks section
        if (dayTasks.length > 0) {
            html += '<div class="calendar__day-view-tasks">';
            dayTasks.forEach(task => {
                const doneClass = task.is_completed ? ' calendar__day-task--done' : '';
                const colorBorder = task.color_tag ? ' style="border-left:3px solid ' + task.color_tag + '"' : '';
                const timeRange = task.start_datetime && task.end_datetime
                    ? '<span class="calendar__day-task-time">' + formatTime(task.start_datetime) + ' – ' + formatTime(task.end_datetime) + '</span>'
                    : '';
                const locationHtml = task.location ? '<span class="calendar__day-task-location">📍 ' + escHtml(task.location) + '</span>' : '';
                const creatorHtml = task.user_name ? '<span class="calendar__day-task-creator">by ' + escHtml(task.user_name) + '</span>' : '';

                html += '<div class="calendar__day-task' + doneClass + '"' + colorBorder + '>'
                    + '<input type="checkbox" class="calendar__task-check" data-task-id="' + task.id + '" ' + (task.is_completed ? 'checked' : '') + '>'
                    + '<div class="calendar__day-task-info">'
                    + '<span class="calendar__day-task-title">' + taskTypeIcon(task.task_type || 'regular') + ' ' + escHtml(task.title) + '</span>'
                    + (task.description ? '<span class="calendar__day-task-desc">' + escHtml(task.description) + '</span>' : '')
                    + '<div class="calendar__day-task-meta">' + timeRange + locationHtml + creatorHtml + '</div>'
                    + '</div>'
                    + '<span class="calendar__day-task-priority" style="background:' + priorityColor(task.priority) + '20;color:' + priorityColor(task.priority) + '">' + priorityLabel(task.priority) + '</span>'
                    + '</div>';
            });
            html += '</div>';
        }

        // Activity section
        if (activity) {
            html += '<div class="calendar__day-view-events">';
            if (activity.docs > 0) {
                html += '<div class="calendar__day-view-event calendar__day-view-event--doc"><span class="calendar__day-view-event-icon">📄</span><span>' + activity.docs + ' document' + (activity.docs > 1 ? 's' : '') + ' uploaded</span></div>';
            }
            if (activity.chats > 0) {
                html += '<div class="calendar__day-view-event calendar__day-view-event--chat"><span class="calendar__day-view-event-icon">💬</span><span>' + activity.chats + ' AI conversation' + (activity.chats > 1 ? 's' : '') + '</span></div>';
            }
            html += '</div>';
        }

        if (dayTasks.length === 0 && !activity) {
            html += '<div class="calendar__day-view-empty">No tasks or activity on this day</div>';
        }

        html += '<button class="calendar__add-task-btn calendar__add-task-btn--day" data-date="' + key + '">+ Add Task</button>';
        html += '</div>';
        grid.innerHTML = html;
    }

    // ══════════════════════════════════════════════
    //  TASK MODAL — Create / Edit tasks
    // ══════════════════════════════════════════════

    function initTaskModal() {
        const overlay = document.getElementById('taskModalOverlay');
        const closeBtn = document.getElementById('taskModalClose');
        const cancelBtn = document.getElementById('taskModalCancel');
        const form = document.getElementById('taskForm');

        if (closeBtn) closeBtn.addEventListener('click', closeTaskModal);
        if (cancelBtn) cancelBtn.addEventListener('click', closeTaskModal);
        if (overlay) overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeTaskModal();
        });

        if (form) {
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                await saveTask();
            });

            // Clear error banner on any input change
            form.addEventListener('input', () => {
                const saveError = document.getElementById('taskSaveError');
                if (saveError) saveError.style.display = 'none';
                const conflictWarning = document.getElementById('taskConflictWarning');
                if (conflictWarning && !conflictWarning.dataset.acknowledged) {
                    conflictWarning.style.display = 'none';
                }
            });
        }

        initColorPicker();
        initMentionAutocomplete();
    }

    // ── Color Picker ──
    function initColorPicker() {
        const picker = document.getElementById('colorPicker');
        if (!picker) return;

        picker.addEventListener('click', (e) => {
            const swatch = e.target.closest('.task-modal__color-swatch');
            if (!swatch) return;

            picker.querySelectorAll('.task-modal__color-swatch').forEach(s => s.classList.remove('active'));
            swatch.classList.add('active');
            selectedColorTag = swatch.dataset.color || '';
        });
    }

    // ── @Mention Autocomplete ──
    function initMentionAutocomplete() {
        const textarea = document.getElementById('taskDescInput');
        const dropdown = document.getElementById('mentionDropdown');
        if (!textarea || !dropdown) return;

        let mentionActive = false;
        let mentionQuery = '';
        let mentionStart = -1;

        textarea.addEventListener('input', () => {
            const val = textarea.value;
            const cursorPos = textarea.selectionStart;

            // Find the @ before cursor
            const textBefore = val.slice(0, cursorPos);
            const atIdx = textBefore.lastIndexOf('@');

            if (atIdx >= 0) {
                const afterAt = textBefore.slice(atIdx + 1);
                // Only trigger if no space before cursor since @ symbol
                if (!/\n/.test(afterAt) && afterAt.length <= 30) {
                    mentionActive = true;
                    mentionStart = atIdx;
                    mentionQuery = afterAt.toLowerCase();
                    showMentionDropdown(mentionQuery);
                    return;
                }
            }

            mentionActive = false;
            dropdown.classList.remove('active');
        });

        textarea.addEventListener('keydown', (e) => {
            if (!mentionActive || !dropdown.classList.contains('active')) return;

            const items = dropdown.querySelectorAll('.task-modal__mention-item');
            const activeItem = dropdown.querySelector('.task-modal__mention-item--active');
            let idx = Array.from(items).indexOf(activeItem);

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (idx < items.length - 1) idx++;
                items.forEach(i => i.classList.remove('task-modal__mention-item--active'));
                items[idx]?.classList.add('task-modal__mention-item--active');
                items[idx]?.scrollIntoView({ block: 'nearest' });
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (idx > 0) idx--;
                items.forEach(i => i.classList.remove('task-modal__mention-item--active'));
                items[idx]?.classList.add('task-modal__mention-item--active');
                items[idx]?.scrollIntoView({ block: 'nearest' });
            } else if (e.key === 'Enter' && activeItem) {
                e.preventDefault();
                selectMention(activeItem.dataset.userId, activeItem.dataset.userName);
            } else if (e.key === 'Escape') {
                mentionActive = false;
                dropdown.classList.remove('active');
            }
        });

        dropdown.addEventListener('click', (e) => {
            const item = e.target.closest('.task-modal__mention-item');
            if (item) selectMention(item.dataset.userId, item.dataset.userName);
        });

        function showMentionDropdown(query) {
            const filtered = teamMembers.filter(m => {
                const name = (m.full_name || m.email || '').toLowerCase();
                return name.includes(query);
            });

            if (filtered.length === 0) {
                dropdown.classList.remove('active');
                return;
            }

            dropdown.innerHTML = filtered.slice(0, 8).map((m, i) => {
                const name = m.full_name || m.email;
                return '<div class="task-modal__mention-item' + (i === 0 ? ' task-modal__mention-item--active' : '') + '" data-user-id="' + m.id + '" data-user-name="' + escHtml(name) + '">'
                    + '<span class="task-modal__mention-avatar">' + getInitials(name) + '</span>'
                    + '<span class="task-modal__mention-name">' + escHtml(name) + '</span>'
                    + '</div>';
            }).join('');
            dropdown.classList.add('active');
        }

        function selectMention(userId, userName) {
            const textarea = document.getElementById('taskDescInput');
            const val = textarea.value;
            const cursorPos = textarea.selectionStart;
            const textBefore = val.slice(0, cursorPos);
            const atIdx = textBefore.lastIndexOf('@');

            // Replace @query with @Name
            const before = val.slice(0, atIdx);
            const after = val.slice(cursorPos);
            textarea.value = before + '@' + userName + ' ' + after;

            // Move cursor after inserted name
            const newPos = atIdx + userName.length + 2;
            textarea.setSelectionRange(newPos, newPos);
            textarea.focus();

            // Add to tagged list
            const uid = parseInt(userId);
            if (!taggedUserIds.includes(uid)) {
                taggedUserIds.push(uid);
                renderTaggedMembers();
            }

            mentionActive = false;
            dropdown.classList.remove('active');
        }
    }

    function renderTaggedMembers() {
        const container = document.getElementById('taggedMembersContainer');
        if (!container) return;

        if (taggedUserIds.length === 0) {
            container.innerHTML = '<span class="task-modal__no-tags">No members tagged — type @ in description</span>';
            return;
        }

        container.innerHTML = taggedUserIds.map(uid => {
            const member = teamMembers.find(m => m.id === uid);
            const name = member ? (member.full_name || member.email) : 'User #' + uid;
            return '<span class="task-modal__tag-chip">'
                + escHtml(name)
                + '<button type="button" class="task-modal__tag-remove" data-uid="' + uid + '">×</button>'
                + '</span>';
        }).join('');

        container.querySelectorAll('.task-modal__tag-remove').forEach(btn => {
            btn.addEventListener('click', () => {
                taggedUserIds = taggedUserIds.filter(id => id !== parseInt(btn.dataset.uid));
                renderTaggedMembers();
            });
        });
    }

    function openTaskModal(forDate, editTask) {
        const overlay = document.getElementById('taskModalOverlay');
        const title = document.getElementById('taskModalTitle');
        const saveBtn = document.getElementById('taskModalSave');
        const editIdField = document.getElementById('taskEditId');
        const startInput = document.getElementById('taskStartInput');
        const endInput = document.getElementById('taskEndInput');
        const titleInput = document.getElementById('taskTitleInput');
        const descInput = document.getElementById('taskDescInput');
        const priorityInput = document.getElementById('taskPriorityInput');
        const locationInput = document.getElementById('taskLocationInput');
        const colorPicker = document.getElementById('colorPicker');
        const taskTypeInput = document.getElementById('taskTypeInput');
        const conflictWarning = document.getElementById('taskConflictWarning');

        if (!overlay) return;

        // Reset conflict warning and error state
        if (conflictWarning) conflictWarning.style.display = 'none';
        const saveError = document.getElementById('taskSaveError');
        if (saveError) saveError.style.display = 'none';

        if (editTask) {
            title.textContent = 'Edit Task';
            saveBtn.textContent = 'Save Changes';
            editIdField.value = editTask.id;
            titleInput.value = editTask.title;
            descInput.value = editTask.description || '';
            startInput.value = toLocalDatetimeValue(editTask.start_datetime);
            endInput.value = toLocalDatetimeValue(editTask.end_datetime);
            locationInput.value = editTask.location || '';
            priorityInput.value = editTask.priority;
            if (taskTypeInput) taskTypeInput.value = editTask.task_type || 'regular';
            selectedColorTag = editTask.color_tag || '';
            taggedUserIds = (editTask.tagged_users || []).map(u => u.id);
        } else {
            title.textContent = 'Add Task';
            saveBtn.textContent = 'Add Task';
            editIdField.value = '';
            titleInput.value = '';
            descInput.value = '';
            locationInput.value = '';
            priorityInput.value = 'medium';
            if (taskTypeInput) taskTypeInput.value = 'regular';
            selectedColorTag = '';
            taggedUserIds = [];

            // Default: today at current hour, +1 hour
            const now = new Date();
            if (forDate) {
                const base = new Date(forDate + 'T' + String(now.getHours()).padStart(2, '0') + ':00:00');
                const endD = new Date(base.getTime() + 3600000);
                startInput.value = toLocalDatetimeValue(base.toISOString());
                endInput.value = toLocalDatetimeValue(endD.toISOString());
            } else {
                const endD = new Date(now.getTime() + 3600000);
                startInput.value = toLocalDatetimeValue(now.toISOString());
                endInput.value = toLocalDatetimeValue(endD.toISOString());
            }
        }

        // Set color picker active state
        if (colorPicker) {
            colorPicker.querySelectorAll('.task-modal__color-swatch').forEach(s => {
                s.classList.toggle('active', (s.dataset.color || '') === selectedColorTag);
            });
        }

        renderTaggedMembers();
        overlay.classList.add('active');
        setTimeout(() => titleInput.focus(), 100);
    }

    function closeTaskModal() {
        const overlay = document.getElementById('taskModalOverlay');
        if (overlay) overlay.classList.remove('active');
        const dropdown = document.getElementById('mentionDropdown');
        if (dropdown) dropdown.classList.remove('active');
        // Clear error/conflict states
        const saveError = document.getElementById('taskSaveError');
        if (saveError) saveError.style.display = 'none';
        const conflictWarning = document.getElementById('taskConflictWarning');
        if (conflictWarning) {
            conflictWarning.style.display = 'none';
            delete conflictWarning.dataset.acknowledged;
        }
    }

    function showTaskModalError(msg) {
        const el = document.getElementById('taskSaveError');
        const txt = document.getElementById('taskSaveErrorText');
        if (!el || !txt) return;
        txt.textContent = msg;
        el.style.display = 'flex';
        // Auto-hide after 6 seconds
        clearTimeout(el._hideTimer);
        el._hideTimer = setTimeout(() => { el.style.display = 'none'; }, 6000);
    }

    async function saveTask() {
        const editId = document.getElementById('taskEditId').value;
        const titleVal = document.getElementById('taskTitleInput').value.trim();
        const descVal = document.getElementById('taskDescInput').value.trim();
        const startVal = document.getElementById('taskStartInput').value;
        const endVal = document.getElementById('taskEndInput').value;
        const priorityVal = document.getElementById('taskPriorityInput').value;
        const locationVal = document.getElementById('taskLocationInput').value.trim();
        const taskTypeVal = document.getElementById('taskTypeInput')?.value || 'regular';

        if (!titleVal || !startVal || !endVal || !currentTeamId) return;

        // Convert local datetime strings to ISO
        const startDt = new Date(startVal).toISOString();
        const endDt = new Date(endVal).toISOString();

        // Validate start < end
        if (new Date(startDt) >= new Date(endDt)) {
            showTaskModalError('End time must be after start time.');
            return;
        }

        // Time conflict detection for time-based task types
        const timeBasedTypes = ['meeting', 'regular'];
        if (timeBasedTypes.includes(taskTypeVal)) {
            const conflictResult = await apiJson(
                '/calendar/tasks/' + currentTeamId + '/check-conflicts', 'POST',
                {
                    start_datetime: startDt,
                    end_datetime: endDt,
                    exclude_task_id: editId ? parseInt(editId) : null,
                }
            );

            if (conflictResult && !conflictResult._error && conflictResult.has_conflict) {
                const conflictWarning = document.getElementById('taskConflictWarning');
                const conflictDetails = document.getElementById('taskConflictDetails');
                if (conflictWarning && conflictDetails) {
                    const names = conflictResult.conflicting_tasks.map(t => '"' + t.title + '"').join(', ');
                    conflictDetails.textContent = 'This overlaps with: ' + names + '. Save anyway?';
                    conflictWarning.style.display = 'flex';

                    // If already showing warning and user presses save again, proceed
                    if (!conflictWarning.dataset.acknowledged) {
                        conflictWarning.dataset.acknowledged = '1';
                        return; // First press just shows warning
                    }
                }
            }
        }

        // Reset conflict acknowledged flag
        const conflictWarning = document.getElementById('taskConflictWarning');
        if (conflictWarning) delete conflictWarning.dataset.acknowledged;

        const body = {
            title: titleVal,
            description: descVal || null,
            start_datetime: startDt,
            end_datetime: endDt,
            priority: priorityVal,
            task_type: taskTypeVal,
            location: locationVal || null,
            color_tag: selectedColorTag || null,
            tagged_user_ids: taggedUserIds.length > 0 ? taggedUserIds : null,
        };

        let result;
        if (editId) {
            result = await apiJson('/calendar/tasks/' + currentTeamId + '/' + editId, 'PATCH', body);
        } else {
            result = await apiJson('/calendar/tasks/' + currentTeamId, 'POST', body);
        }

        if (result && !result._error) {
            closeTaskModal();
            await loadCalendarTasks();
            // Refresh day panel if open
            if (selectedDate) refreshDayPanel(selectedDate);
        } else {
            const detail = (result && result.detail) ? result.detail : 'Could not save task. Please try again.';
            showTaskModalError(typeof detail === 'string' ? detail : JSON.stringify(detail));
        }
    }

    async function toggleTaskComplete(taskId, completed) {
        if (!currentTeamId) return;
        await apiJson('/calendar/tasks/' + currentTeamId + '/' + taskId, 'PATCH', {
            is_completed: completed,
        });
        await loadCalendarTasks();
        if (selectedDate) refreshDayPanel(selectedDate);
    }

    async function deleteTask(taskId) {
        if (!currentTeamId) return;
        const res = await fetch(API + '/calendar/tasks/' + currentTeamId + '/' + taskId, {
            method: 'DELETE',
            headers,
        });
        if (res.ok || res.status === 204) {
            await loadCalendarTasks();
            if (selectedDate) refreshDayPanel(selectedDate);
        }
    }

    // ══════════════════════════════════════════════
    //  DAY PANEL — Shows tasks for a specific day
    // ══════════════════════════════════════════════

    function initDayPanel() {
        const overlay = document.getElementById('dayPanelOverlay');
        const closeBtn = document.getElementById('dayPanelClose');
        const addBtn = document.getElementById('dayPanelAddBtn');

        if (closeBtn) closeBtn.addEventListener('click', closeDayPanel);
        if (overlay) overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeDayPanel();
        });
        if (addBtn) addBtn.addEventListener('click', () => {
            if (selectedDate) openTaskModal(selectedDate);
        });
    }

    function openDayPanel(key) {
        selectedDate = key;
        const overlay = document.getElementById('dayPanelOverlay');
        if (!overlay) return;

        refreshDayPanel(key);
        overlay.classList.add('active');
    }

    function refreshDayPanel(key) {
        const titleEl = document.getElementById('dayPanelTitle');
        const countEl = document.getElementById('dayPanelCount');
        const tasksEl = document.getElementById('dayPanelTasks');
        if (!titleEl || !tasksEl) return;

        titleEl.textContent = formatDateLabel(key);
        const dayTasks = tasksForDate(key);
        const doneCount = dayTasks.filter(t => t.is_completed).length;
        countEl.textContent = dayTasks.length === 0 ? 'No tasks' : doneCount + '/' + dayTasks.length + ' done';

        if (dayTasks.length === 0) {
            tasksEl.innerHTML = '<div class="day-panel__empty"><p>No tasks for this day</p><p class="day-panel__empty-hint">Click "Add Task" to create one</p></div>';
            return;
        }

        let html = '';
        dayTasks.forEach(task => {
            const doneClass = task.is_completed ? ' day-panel__task--done' : '';
            const colorBorder = task.color_tag ? ' border-left: 3px solid ' + task.color_tag + ';' : '';

            // Time range
            let timeHtml = '';
            if (task.start_datetime && task.end_datetime) {
                const startDay = task.start_datetime.slice(0, 10);
                const endDay = task.end_datetime.slice(0, 10);
                if (startDay === endDay) {
                    timeHtml = '<span class="day-panel__task-time">🕐 ' + formatTime(task.start_datetime) + ' – ' + formatTime(task.end_datetime) + '</span>';
                } else {
                    timeHtml = '<span class="day-panel__task-time">🕐 ' + formatDateTimeShort(task.start_datetime) + ' → ' + formatDateTimeShort(task.end_datetime) + '</span>';
                }
            }

            // Location
            const locationHtml = task.location ? '<span class="day-panel__task-location">📍 ' + escHtml(task.location) + '</span>' : '';

            // Creator name
            const creatorHtml = task.user_name ? '<span class="day-panel__task-creator">by ' + escHtml(task.user_name) + '</span>' : '';

            // Tagged users
            let taggedHtml = '';
            if (task.tagged_users && task.tagged_users.length > 0) {
                taggedHtml = '<div class="day-panel__task-tagged">'
                    + task.tagged_users.map(u => '<span class="day-panel__tag-chip">' + escHtml(u.full_name || u.email) + '</span>').join('')
                    + '</div>';
            }

            html += '<div class="day-panel__task' + doneClass + '" style="' + colorBorder + '">'
                + '<div class="day-panel__task-left">'
                + '<input type="checkbox" class="day-panel__task-check" data-task-id="' + task.id + '" ' + (task.is_completed ? 'checked' : '') + '>'
                + '<div class="day-panel__task-info">'
                + '<span class="day-panel__task-title">' + escHtml(task.title) + '</span>'
                + (task.description ? '<span class="day-panel__task-desc">' + escHtml(task.description) + '</span>' : '')
                + '<div class="day-panel__task-meta">' + timeHtml + locationHtml + creatorHtml + '</div>'
                + taggedHtml
                + '</div>'
                + '</div>'
                + '<div class="day-panel__task-right">'
                + '<span class="day-panel__task-type">' + taskTypeIcon(task.task_type || 'regular') + '</span>'
                + '<span class="day-panel__task-priority" style="background:' + priorityColor(task.priority) + '15;color:' + priorityColor(task.priority) + '">' + priorityLabel(task.priority) + '</span>'
                + '<button class="day-panel__task-edit" data-task-id="' + task.id + '" title="Edit">'
                + '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="14" height="14"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>'
                + '</button>'
                + '<button class="day-panel__task-delete" data-task-id="' + task.id + '" title="Delete">'
                + '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="14" height="14"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>'
                + '</button>'
                + '</div>'
                + '</div>';
        });

        tasksEl.innerHTML = html;

        // Bind events inside panel
        tasksEl.querySelectorAll('.day-panel__task-check').forEach(cb => {
            cb.addEventListener('change', () => {
                toggleTaskComplete(parseInt(cb.dataset.taskId), cb.checked);
            });
        });
        tasksEl.querySelectorAll('.day-panel__task-edit').forEach(btn => {
            btn.addEventListener('click', () => {
                const task = calTasks.find(t => t.id === parseInt(btn.dataset.taskId));
                if (task) openTaskModal(null, task);
            });
        });
        tasksEl.querySelectorAll('.day-panel__task-delete').forEach(btn => {
            btn.addEventListener('click', () => {
                if (confirm('Delete this task?')) {
                    deleteTask(parseInt(btn.dataset.taskId));
                }
            });
        });
    }

    function closeDayPanel() {
        selectedDate = null;
        const overlay = document.getElementById('dayPanelOverlay');
        if (overlay) overlay.classList.remove('active');
        drawCalendar();
    }

    // ══════════════════════════════════════════════
    //  AI ACTIONABLE STEPS — Suggestions panel
    // ══════════════════════════════════════════════

    async function loadAISuggestions() {
        if (!currentTeamId || aiSuggestionsLoading) return;
        aiSuggestionsLoading = true;
        seenSuggestionTitles = new Set(); // reset on full refresh

        const loadingEl = document.getElementById('aiSuggestionsLoading');
        const emptyEl = document.getElementById('aiSuggestionsEmpty');
        const listEl = document.getElementById('aiSuggestionsList');
        if (loadingEl) loadingEl.style.display = 'flex';
        if (emptyEl) emptyEl.style.display = 'none';
        if (listEl) listEl.innerHTML = '';

        const result = await api('/calendar/ai-suggestions/' + currentTeamId);
        aiSuggestionsLoading = false;

        if (loadingEl) loadingEl.style.display = 'none';

        if (!result || !result.suggestions || result.suggestions.length === 0) {
            if (emptyEl) emptyEl.style.display = 'flex';
            aiSuggestions = [];
            return;
        }

        // Cap at 4, track seen titles
        aiSuggestions = result.suggestions.slice(0, 4);
        aiSuggestions.forEach(s => seenSuggestionTitles.add(s.title));
        renderAISuggestions();
    }

    function renderAISuggestions() {
        const listEl = document.getElementById('aiSuggestionsList');
        if (!listEl) return;

        listEl.innerHTML = aiSuggestions.map((s, idx) => {
            const confidencePct = Math.round(s.confidence * 100);
            const confidenceColor = s.confidence >= 0.7 ? '#22c55e' : s.confidence >= 0.4 ? '#f59e0b' : '#ef4444';
            return '<div class="ai-suggestion" data-idx="' + idx + '">'
                + '<div class="ai-suggestion__header">'
                + '<span class="ai-suggestion__type-badge">' + taskTypeIcon(s.task_type) + ' ' + taskTypeLabel(s.task_type) + '</span>'
                + '<span class="ai-suggestion__confidence" style="color:' + confidenceColor + '">' + confidencePct + '% match</span>'
                + '</div>'
                + '<div class="ai-suggestion__title">' + escHtml(s.title) + '</div>'
                + '<div class="ai-suggestion__desc">' + escHtml(s.description) + '</div>'
                + (s.proposed_deadline ? '<div class="ai-suggestion__deadline">📅 Suggested: ' + s.proposed_deadline + '</div>' : '')
                + (s.source_context ? '<div class="ai-suggestion__source">📄 ' + escHtml(s.source_context) + '</div>' : '')
                + '<div class="ai-suggestion__confidence-bar"><div class="ai-suggestion__confidence-fill" style="width:' + confidencePct + '%;background:' + confidenceColor + '"></div></div>'
                + '<div class="ai-suggestion__actions">'
                + '<button class="ai-suggestion__accept" data-idx="' + idx + '" title="Accept — prefill task form">✓ Accept</button>'
                + '<button class="ai-suggestion__dismiss" data-idx="' + idx + '" title="Dismiss this suggestion">✕ Dismiss</button>'
                + '</div>'
                + '</div>';
        }).join('');

        // Bind accept / dismiss
        listEl.querySelectorAll('.ai-suggestion__accept').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                acceptAISuggestion(parseInt(btn.dataset.idx));
            });
        });
        listEl.querySelectorAll('.ai-suggestion__dismiss').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                dismissAISuggestion(parseInt(btn.dataset.idx));
            });
        });
    }

    function acceptAISuggestion(idx) {
        const s = aiSuggestions[idx];
        if (!s) return;

        // Open modal first (sets default dates synchronously)
        openTaskModal(null);

        // Fill fields immediately — openTaskModal is synchronous so DOM is ready
        const titleInput = document.getElementById('taskTitleInput');
        const descInput = document.getElementById('taskDescInput');
        const typeInput = document.getElementById('taskTypeInput');
        const priorityInput = document.getElementById('taskPriorityInput');
        const modalTitle = document.getElementById('taskModalTitle');

        if (titleInput) titleInput.value = s.title;
        if (descInput) descInput.value = s.description + (s.source_context ? '\n\n[Source: ' + s.source_context + ']' : '');
        if (typeInput) typeInput.value = s.task_type || 'action_item';
        if (priorityInput) priorityInput.value = s.priority || 'medium';
        if (modalTitle) modalTitle.textContent = '⚡ AI Suggested Task';

        // Override dates if AI gave a proposed deadline
        if (s.proposed_deadline) {
            const startInput = document.getElementById('taskStartInput');
            const endInput = document.getElementById('taskEndInput');
            const deadlineDate = new Date(s.proposed_deadline + 'T09:00:00');
            const endDate = new Date(deadlineDate.getTime() + 3600000);
            if (startInput) startInput.value = toLocalDatetimeValue(deadlineDate.toISOString());
            if (endInput) endInput.value = toLocalDatetimeValue(endDate.toISOString());
        }

        // Dismiss AFTER filing fields (so idx is still valid during fill)
        dismissAISuggestion(idx);
    }

    function dismissAISuggestion(idx) {
        aiSuggestions.splice(idx, 1);
        renderAISuggestions();

        if (aiSuggestions.length === 0) {
            const emptyEl = document.getElementById('aiSuggestionsEmpty');
            if (emptyEl) emptyEl.style.display = 'flex';
        }

        // Silently try to fetch one replacement — only if we're under 4
        if (aiSuggestions.length < 4) {
            tryFetchReplacement();
        }
    }

    async function tryFetchReplacement() {
        if (!currentTeamId) return;
        const result = await api('/calendar/ai-suggestions/' + currentTeamId);
        if (!result || !result.suggestions || result.suggestions.length === 0) return;

        // Find first suggestion we haven't shown yet
        const fresh = result.suggestions.find(s => !seenSuggestionTitles.has(s.title));
        if (!fresh) return; // Nothing new — leave the gap, don't force anything

        seenSuggestionTitles.add(fresh.title);
        aiSuggestions.push(fresh);

        // Hide the empty state if it was showing
        const emptyEl = document.getElementById('aiSuggestionsEmpty');
        if (emptyEl) emptyEl.style.display = 'none';

        // Append the new card (animated)
        appendSuggestionCard(fresh, aiSuggestions.length - 1);
    }

    function appendSuggestionCard(s, idx) {
        const listEl = document.getElementById('aiSuggestionsList');
        if (!listEl) return;
        const confidencePct = Math.round(s.confidence * 100);
        const confidenceColor = s.confidence >= 0.7 ? '#22c55e' : s.confidence >= 0.4 ? '#f59e0b' : '#ef4444';
        const div = document.createElement('div');
        div.className = 'ai-suggestion ai-suggestion--new';
        div.dataset.idx = idx;
        div.innerHTML = '<div class="ai-suggestion__header">'
            + '<span class="ai-suggestion__type-badge">' + taskTypeIcon(s.task_type) + ' ' + taskTypeLabel(s.task_type) + '</span>'
            + '<span class="ai-suggestion__confidence" style="color:' + confidenceColor + '">' + confidencePct + '% match</span>'
            + '</div>'
            + '<div class="ai-suggestion__title">' + escHtml(s.title) + '</div>'
            + '<div class="ai-suggestion__desc">' + escHtml(s.description) + '</div>'
            + (s.proposed_deadline ? '<div class="ai-suggestion__deadline">📅 Suggested: ' + s.proposed_deadline + '</div>' : '')
            + (s.source_context ? '<div class="ai-suggestion__source">📄 ' + escHtml(s.source_context) + '</div>' : '')
            + '<div class="ai-suggestion__confidence-bar"><div class="ai-suggestion__confidence-fill" style="width:' + confidencePct + '%;background:' + confidenceColor + '"></div></div>'
            + '<div class="ai-suggestion__actions">'
            + '<button class="ai-suggestion__accept" data-idx="' + idx + '" title="Accept">✓ Accept</button>'
            + '<button class="ai-suggestion__dismiss" data-idx="' + idx + '" title="Dismiss">✕ Dismiss</button>'
            + '</div>';
        listEl.appendChild(div);
        div.querySelector('.ai-suggestion__accept').addEventListener('click', (e) => {
            e.stopPropagation();
            acceptAISuggestion(parseInt(div.dataset.idx));
        });
        div.querySelector('.ai-suggestion__dismiss').addEventListener('click', (e) => {
            e.stopPropagation();
            dismissAISuggestion(parseInt(div.dataset.idx));
        });
        // Trigger animation
        requestAnimationFrame(() => div.classList.add('ai-suggestion--visible'));
    }

    function initAISuggestionsPanel() {
        const refreshBtn = document.getElementById('aiSuggestionsRefresh');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                loadAISuggestions();
            });
        }
    }

    // ── Team Info ──
    function renderTeamInfo(roleData) {
        const panel = document.getElementById('bannerTeamInfo');
        const container = document.getElementById('bannerTeamInfoBody');
        if (!panel || !container) return;

        const team = teams.find(t => t.id === currentTeamId);
        if (!team) { panel.style.display = 'none'; return; }

        panel.style.display = '';
        const role = roleData ? roleData.role : 'member';
        const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);

        container.innerHTML =
            '<div class="team-info__row">' +
                '<span class="team-info__label">Team</span>' +
                '<span class="team-info__value">' + escHtml(team.name) + '</span>' +
            '</div>' +
            '<div class="team-info__row">' +
                '<span class="team-info__label">Your Role</span>' +
                '<span class="team-info__value">' + roleLabel + '</span>' +
            '</div>';
    }

    // ── Getting Started ──
    function renderGettingStarted(stats, docs) {
        const card = document.getElementById('gettingStartedCard');
        if (!card) return;

        const hasDocs = docs && docs.documents && docs.documents.length > 0;
        const hasChunks = stats && stats.total_chunks > 0;

        if (hasDocs || hasChunks) {
            card.style.display = 'none';
        } else {
            card.style.display = '';
        }
    }

    // ── Boot ──
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
