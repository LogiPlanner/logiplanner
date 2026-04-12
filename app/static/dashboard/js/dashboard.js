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
    let syncToGoogleCalendar = false;

    // AI suggestions state
    let aiSuggestions = [];
    let aiSuggestionsLoading = false;
    let seenSuggestionTitles = new Set(); // tracks titles shown so far to avoid re-showing

    // ── Helpers ──
    async function api(path, opts) {
        const res = await window.__lp.authFetch(API + path, { ...opts });
        if (!res) return null;
        if (!res.ok) return null;
        if (res.status === 204) return true;
        return res.json();
    }

    async function apiJson(path, method, body) {
        const opts = { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
        const res = await window.__lp.authFetch(API + path, opts);
        if (!res) return null;
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

    // ── Deferred Project Setup (called from onboarding wizard) ──
    async function handlePendingSetup(rawPayload) {
        const overlay = document.getElementById('welcomeOverlay');
        const msgEl = document.getElementById('welcomeOverlayMsg');
        if (overlay) overlay.style.display = 'flex';

        try {
            const payload = JSON.parse(rawPayload);

            if (msgEl) msgEl.textContent = 'Creating your project "' + (payload.team_name || '') + '"…';

            const res = await window.__lp.authFetch(API + '/onboarding/setup-project', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            if (res && res.ok) {
                sessionStorage.removeItem('lp_pending_setup');
                if (msgEl) msgEl.textContent = 'Project created! Loading your dashboard…';
                if (overlay) overlay.classList.add('welcome-overlay--success');
                // Brief pause so user sees the success state
                await new Promise(r => setTimeout(r, 1200));
            } else {
                const err = await res?.json().catch(() => null);
                const isNonRetryableSetupError = !!(res && [400, 409, 422].includes(res.status));
                console.error('Setup project failed:', err);

                if (isNonRetryableSetupError) {
                    sessionStorage.removeItem('lp_pending_setup');
                    if (msgEl) {
                        msgEl.textContent =
                            err?.detail ||
                            'We could not create your project with the saved setup details. Please re-run onboarding and choose a different project name if needed.';
                    }
                } else if (msgEl) {
                    msgEl.textContent =
                        err?.detail || 'Setup had an issue. We will retry automatically when you reopen your dashboard.';
                }
                await new Promise(r => setTimeout(r, 2000));
            }
        } catch (e) {
            console.error('handlePendingSetup error:', e);
            if (e instanceof SyntaxError) {
                // Malformed JSON — clear it immediately to prevent an infinite retry loop
                sessionStorage.removeItem('lp_pending_setup');
                if (msgEl) msgEl.textContent = 'Setup data was corrupted. Please re-run onboarding.';
            } else {
                if (msgEl) msgEl.textContent = 'Something went wrong. We will retry setup automatically when you reopen your dashboard.';
            }
            await new Promise(r => setTimeout(r, 1500));
        }

        if (overlay) {
            overlay.style.opacity = '0';
            overlay.style.transition = 'opacity 0.4s ease';
            setTimeout(() => { overlay.style.display = 'none'; }, 400);
        }
    }

    // ── Initialize ──
    async function init() {
        // ── Deferred Project Setup ──
        const pendingSetup = sessionStorage.getItem('lp_pending_setup');
        if (pendingSetup) {
            await handlePendingSetup(pendingSetup);
        }

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
            greetEl.innerHTML = getGreeting() + (userName ? ', <strong>' + escHtml(userName.split(' ')[0]) + '</strong>' : '');
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

        // Render sidebar team buttons
        renderSidebarTeams();

        updateWelcomeBanner();
        initCalendarControls();
        initTaskModal();
        initDayPanel();
        initAISuggestionsPanel();
        loadTeamData();

        // Voice recorder (must be after currentTeamId is set and common.js has loaded)
        if (window.__lp && window.__lp.initVoiceRecorder) {
            window.__lp.initVoiceRecorder({
                teamId: currentTeamId,
                fetchNotes: function () { return api('/meetings/notes/' + currentTeamId); },
                onDone: function () {},
                timeoutMsg: 'Still processing — check Meetings shortly.'
            });
        }
    }

    // ── Sidebar Team Buttons ──
    const _teamColors = ['#4f46e5','#7c3aed','#06d6a0','#f59e0b','#ef4444','#3b82f6','#ec4899','#14b8a6'];

    function renderSidebarTeams() {
        const list = document.getElementById('teamList');
        if (!list || teams.length === 0) return;

        list.innerHTML = '';
        teams.forEach((t, i) => {
            const initials = (t.name || 'T').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
            const color = _teamColors[i % _teamColors.length];
            const btn = document.createElement('button');
            btn.className = 'sidebar__team-btn' + (t.id === currentTeamId ? ' active' : '');
            btn.dataset.teamId = t.id;
            btn.innerHTML = '<span class="sidebar__team-icon" style="background:' + color + '">' + initials + '</span>'
                + '<span class="sidebar__team-name">' + escHtml(t.name) + '</span>';
            btn.addEventListener('click', () => {
                if (t.id === currentTeamId) return;
                currentTeamId = t.id;
                localStorage.setItem('selected_team_id', currentTeamId);
                const sel = document.getElementById('teamSelect');
                if (sel) sel.value = currentTeamId;
                list.querySelectorAll('.sidebar__team-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                loadTeamData();
            });
            list.appendChild(btn);
        });
    }

    function updateWelcomeBanner() {
        const team = teams.find(t => t.id === currentTeamId);
        const titleEl = document.getElementById('welcomeTitle');
        const labelEl = document.getElementById('teamLabel');
        const dateEl = document.getElementById('heroDate');

        if (titleEl && userName) {
            titleEl.innerHTML = 'Welcome back, <em>' + escHtml(userName.split(' ')[0]) + '</em>';
        }
        if (labelEl && team) {
            labelEl.textContent = team.name;
        }
        if (dateEl) {
            dateEl.textContent = new Date().toLocaleDateString('en-US', {
                weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
            });
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
        renderStats(stats, docs, members);
        renderTodaysFocus();
        renderTeamInfo(roleData);
        renderGettingStarted(stats, docs);
        loadAISuggestions();
        loadRecentKnowledge();
        loadUpcomingEvents();
    }

    // ── Stats Strip ──
    function renderStats(stats, docs, members) {
        const docsEl = document.getElementById('statDocsValue');
        const tasksEl = document.getElementById('statTasksValue');
        const membersEl = document.getElementById('statMembersValue');
        const brainEl = document.getElementById('statBrainValue');

        const docCount = docs && docs.documents ? docs.documents.length : 0;
        const activeTasks = calTasks.filter(t => !t.is_completed).length;
        const memberCount = members ? members.length : 0;
        const chunkCount = stats && stats.total_chunks ? stats.total_chunks : 0;

        if (docsEl) docsEl.textContent = docCount;
        if (tasksEl) tasksEl.textContent = activeTasks;
        if (membersEl) membersEl.textContent = memberCount;
        if (brainEl) brainEl.textContent = chunkCount;
    }

    // ── Today's Focus ──
    function renderTodaysFocus() {
        const loadingEl = document.getElementById('todayFocusLoading');
        const emptyEl = document.getElementById('todayFocusEmpty');
        const listEl = document.getElementById('todayFocusList');
        const countEl = document.getElementById('todayFocusCount');

        if (loadingEl) loadingEl.style.display = 'none';

        const todayStr = dateKey(new Date());
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = dateKey(tomorrow);

        // Tasks for today + tomorrow, incomplete first
        const todayTasks = calTasks.filter(t => taskSpansDate(t, todayStr) || taskSpansDate(t, tomorrowStr));
        todayTasks.sort((a, b) => {
            if (a.is_completed !== b.is_completed) return a.is_completed ? 1 : -1;
            return new Date(a.start_datetime) - new Date(b.start_datetime);
        });

        const incomplete = todayTasks.filter(t => !t.is_completed);
        if (countEl) countEl.textContent = incomplete.length + ' task' + (incomplete.length !== 1 ? 's' : '');

        if (todayTasks.length === 0) {
            if (emptyEl) emptyEl.style.display = 'flex';
            if (listEl) listEl.innerHTML = '';
            return;
        }

        if (emptyEl) emptyEl.style.display = 'none';
        if (!listEl) return;

        listEl.innerHTML = todayTasks.map(task => {
            const doneClass = task.is_completed ? ' focus-task--done' : '';
            const colorBar = task.color_tag
                ? '<div class="focus-task__color-bar" style="background:' + task.color_tag + '"></div>'
                : '';
            const timeStr = task.start_datetime ? formatTime(task.start_datetime) : '';
            const dateLabel = task.start_datetime && task.start_datetime.slice(0, 10) === tomorrowStr ? 'Tomorrow' : 'Today';
            const metaParts = [taskTypeIcon(task.task_type || 'regular') + ' ' + dateLabel];
            if (timeStr) metaParts.push(timeStr);
            if (task.location) metaParts.push('📍 ' + escHtml(task.location));

            return '<div class="focus-task' + doneClass + '" data-date="' + task.start_datetime.slice(0, 10) + '">'
                + colorBar
                + '<input type="checkbox" class="focus-task__check" data-task-id="' + task.id + '" ' + (task.is_completed ? 'checked' : '') + '>'
                + '<div class="focus-task__body">'
                + '<div class="focus-task__title">' + escHtml(task.title) + '</div>'
                + '<div class="focus-task__meta">' + metaParts.join(' · ') + '</div>'
                + '</div>'
                + '<span class="focus-task__priority" style="background:' + priorityColor(task.priority) + '20;color:' + priorityColor(task.priority) + '">'
                + priorityLabel(task.priority) + '</span>'
                + '</div>';
        }).join('');

        // Attach checkbox handlers
        listEl.querySelectorAll('.focus-task__check').forEach(cb => {
            cb.addEventListener('change', (e) => {
                e.stopPropagation();
                toggleTaskComplete(parseInt(cb.dataset.taskId), cb.checked);
            });
        });

        // Click on task row opens day panel
        listEl.querySelectorAll('.focus-task').forEach(el => {
            el.addEventListener('click', (e) => {
                if (e.target.classList.contains('focus-task__check')) return;
                const taskDate = el.dataset.date;
                if (taskDate) openDayPanel(taskDate);
            });
        });
    }

    // ── Recent Knowledge ──
    async function loadRecentKnowledge() {
        const loadingEl = document.getElementById('recentKnowledgeLoading');
        const emptyEl = document.getElementById('recentKnowledgeEmpty');
        const listEl = document.getElementById('recentKnowledgeList');
        if (loadingEl) loadingEl.style.display = 'flex';
        if (emptyEl) emptyEl.style.display = 'none';
        if (listEl) listEl.innerHTML = '';

        try {
            var resp = await fetch('/api/v1/rag/recent-chunks/' + currentTeamId + '?limit=5', {
                headers: { 'Authorization': 'Bearer ' + token }
            });
            if (!resp.ok) throw new Error('Failed to fetch recent knowledge');
            var data = await resp.json();

            if (loadingEl) loadingEl.style.display = 'none';

            if (!data.items || data.items.length === 0) {
                if (emptyEl) emptyEl.style.display = 'flex';
                return;
            }
            if (emptyEl) emptyEl.style.display = 'none';

            if (listEl) {
                listEl.innerHTML = data.items.map(function (item) {
                    var icon = docTypeIcon(item.doc_type);
                    var timeAgo = relativeTime(item.uploaded_at);
                    return '<div class="knowledge-item">'
                        + '<div class="knowledge-item__icon">' + icon + '</div>'
                        + '<div class="knowledge-item__body">'
                        + '<div class="knowledge-item__summary">' + escHtml(item.summary) + '</div>'
                        + '<div class="knowledge-item__meta">'
                        + '<span>' + escHtml(item.filename) + '</span>'
                        + '<span>' + timeAgo + '</span>'
                        + '</div>'
                        + '</div>'
                        + '</div>';
                }).join('');
            }
        } catch (e) {
            console.error('loadRecentKnowledge error:', e);
            if (loadingEl) loadingEl.style.display = 'none';
            if (emptyEl) emptyEl.style.display = 'flex';
        }
    }

    function docTypeIcon(t) {
        if (t === 'pdf') return '📕';
        if (t === 'docx' || t === 'doc') return '📘';
        if (t === 'txt' || t === 'text_input') return '📝';
        if (t === 'md') return '📓';
        if (t === 'folder') return '📁';
        return '📄';
    }

    function relativeTime(isoStr) {
        if (!isoStr) return '';
        var now = Date.now();
        var then = new Date(isoStr).getTime();
        var diffSec = Math.floor((now - then) / 1000);
        if (diffSec < 60) return 'just now';
        var diffMin = Math.floor(diffSec / 60);
        if (diffMin < 60) return diffMin + 'm ago';
        var diffHr = Math.floor(diffMin / 60);
        if (diffHr < 24) return diffHr + 'h ago';
        var diffDay = Math.floor(diffHr / 24);
        if (diffDay < 7) return diffDay + 'd ago';
        return new Date(isoStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

    // ── Upcoming Events ──
    async function loadUpcomingEvents() {
        var loadingEl = document.getElementById('upcomingEventsLoading');
        var emptyEl = document.getElementById('upcomingEventsEmpty');
        var listEl = document.getElementById('upcomingEventsList');

        if (!currentTeamId) {
            if (loadingEl) loadingEl.style.display = 'none';
            if (emptyEl) emptyEl.style.display = 'flex';
            return;
        }

        // Fetch tasks from today onward (next 14 days)
        var today = new Date();
        var futureDate = new Date();
        futureDate.setDate(today.getDate() + 14);
        var result = await api(
            '/calendar/tasks/' + currentTeamId
            + '?start_date=' + dateKey(today)
            + '&end_date=' + dateKey(futureDate)
        );

        if (loadingEl) loadingEl.style.display = 'none';

        var tasks = result && result.tasks ? result.tasks : [];
        // Filter only future or today tasks, exclude completed
        var now = new Date();
        tasks = tasks.filter(function (t) {
            return !t.is_completed && new Date(t.end_datetime) >= now;
        });
        // Sort by start_datetime ascending
        tasks.sort(function (a, b) {
            return new Date(a.start_datetime) - new Date(b.start_datetime);
        });
        // Limit to 5
        tasks = tasks.slice(0, 5);

        if (tasks.length === 0) {
            if (emptyEl) emptyEl.style.display = 'flex';
            if (listEl) listEl.innerHTML = '';
            return;
        }
        if (emptyEl) emptyEl.style.display = 'none';

        var todayKey = dateKey(today);
        var tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        var tomorrowKey = dateKey(tomorrow);

        if (listEl) {
            listEl.innerHTML = tasks.map(function (t) {
                var color = t.color_tag || '#6366f1';
                var startDt = new Date(t.start_datetime);
                var taskDateKey = t.start_datetime.slice(0, 10);
                var badge = '';
                if (taskDateKey === todayKey) {
                    badge = '<span class="event-item__badge event-item__badge--today">Today</span>';
                } else if (taskDateKey === tomorrowKey) {
                    badge = '<span class="event-item__badge event-item__badge--tomorrow">Tomorrow</span>';
                } else {
                    badge = '<span class="event-item__badge event-item__badge--upcoming">'
                        + startDt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + '</span>';
                }
                var timeStr = startDt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                return '<div class="event-item event-item--clickable" data-task-date="' + taskDateKey + '">'
                    + '<div class="event-item__color-bar" style="background:' + color + '"></div>'
                    + '<div class="event-item__body">'
                    + '<div class="event-item__title">' + escHtml(t.title) + '</div>'
                    + '<div class="event-item__time">' + taskTypeIcon(t.task_type) + ' ' + timeStr
                    + (t.location ? ' · ' + escHtml(t.location) : '') + '</div>'
                    + '</div>'
                    + badge
                    + '</div>';
            }).join('');

            // Attach click handlers to open day panel
            listEl.querySelectorAll('.event-item--clickable').forEach(function (el) {
                el.addEventListener('click', function () {
                    var taskDate = el.dataset.taskDate;
                    if (taskDate) openDayPanel(taskDate);
                });
            });
        }
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
            syncToGoogleCalendar = false;
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
            syncToGoogleCalendar = false;
            const googleInput = document.getElementById('taskGoogleCalendarInput');
            if (googleInput) googleInput.checked = false;

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

        const googleInput = document.getElementById('taskGoogleCalendarInput');
        if (googleInput) {
            googleInput.checked = syncToGoogleCalendar;
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

    function formatGoogleCalendarDate(isoString) {
        const date = new Date(isoString);
        return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    }

    function buildGoogleCalendarUrl(task) {
        const title = encodeURIComponent(task.title || '');
        const details = encodeURIComponent(task.description || '');
        const location = encodeURIComponent(task.location || '');
        const dates = formatGoogleCalendarDate(task.start_datetime) + '/' + formatGoogleCalendarDate(task.end_datetime);
        const params = [
            'action=TEMPLATE',
            'text=' + title,
            'dates=' + dates,
            details ? 'details=' + details : '',
            location ? 'location=' + location : '',
        ].filter(Boolean).join('&');
        return 'https://calendar.google.com/calendar/render?' + params;
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

        // Open the Google Calendar window synchronously (before any await) so
        // browsers treat it as user-initiated and don't block the popup.
        const googleInput = document.getElementById('taskGoogleCalendarInput');
        syncToGoogleCalendar = googleInput?.checked || false;
        let googleWindow = null;
        if (syncToGoogleCalendar) {
            googleWindow = window.open('about:blank', '_blank');
        }

        try {
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
                            if (googleWindow) googleWindow.close();
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

                if (syncToGoogleCalendar) {
                    const url = buildGoogleCalendarUrl(result);
                    if (googleWindow) {
                        googleWindow.location.href = url;
                    } else {
                        window.open(url, '_blank');
                    }
                    syncToGoogleCalendar = false;
                }
            } else {
                if (googleWindow) googleWindow.close();
                const detail = (result && result.detail) ? result.detail : 'Could not save task. Please try again.';
                showTaskModalError(typeof detail === 'string' ? detail : JSON.stringify(detail));
            }
        } catch (err) {
            console.error('Task save error:', err);
            if (googleWindow) googleWindow.close();
            showTaskModalError('An unexpected error occurred. Please try again.');
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

    // ── Subteam change — update eyebrow label ──
    window.addEventListener('subteamchange', (e) => {
        const labelEl = document.getElementById('teamLabel');
        if (!labelEl) return;
        const { name } = e.detail || {};
        const team = teams.find(t => t.id === currentTeamId);
        const projectName = team ? team.name : 'Your Workspace';
        labelEl.textContent = name && name !== 'All Teams'
            ? projectName + ' › ' + name
            : projectName;
    });

    // ── Boot ──
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
