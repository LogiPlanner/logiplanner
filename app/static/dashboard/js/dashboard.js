/* ═══════════════════════════════════════════════════════
   DASHBOARD JS — LogiPlanner
   Loads real data from API, team-aware, dynamic
   ═══════════════════════════════════════════════════════ */

(function () {
    'use strict';

    const API = '/api/v1';
    const token = localStorage.getItem('access_token');
    if (!token) return;

    const headers = { 'Authorization': 'Bearer ' + token };

    // ── State ──
    let currentTeamId = null;
    let teams = [];
    let userName = '';

    // ── Helpers ──
    async function api(path) {
        const res = await fetch(API + path, { headers });
        if (res.status === 401) {
            localStorage.removeItem('access_token');
            window.location.href = '/login';
            return null;
        }
        if (!res.ok) return null;
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

    function timeAgo(dateStr) {
        if (!dateStr) return '';
        const now = new Date();
        const date = new Date(dateStr);
        const diff = Math.floor((now - date) / 1000);
        if (diff < 60) return 'just now';
        if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
        if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
        if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
        return date.toLocaleDateString();
    }

    function formatBytes(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / 1048576).toFixed(1) + ' MB';
    }

    function docTypeIcon(type) {
        const map = { pdf: '📕', docx: '📘', doc: '📘', txt: '📝', md: '📗', text: '💬' };
        return map[type] || '📄';
    }

    function docTypeClass(type) {
        const map = { pdf: 'pdf', docx: 'docx', doc: 'docx', txt: 'txt', md: 'md', text: 'text' };
        return map[type] || 'txt';
    }

    function truncate(str, len) {
        if (!str) return '';
        return str.length > len ? str.slice(0, len) + '…' : str;
    }

    // ── Initialize ──
    async function init() {
        // Load user profile and teams in parallel
        const [profile, teamsData] = await Promise.all([
            api('/profile-status'),
            api('/user-teams'),
        ]);

        if (!profile || !teamsData) return;

        // Handle incomplete profile
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

        // Set greeting
        const greetEl = document.getElementById('greetingText');
        if (greetEl) {
            greetEl.innerHTML = getGreeting() + (userName ? ', <span>' + userName.split(' ')[0] + '</span>' : '');
        }

        // Set avatar
        const avatarEl = document.getElementById('avatarInitials');
        if (avatarEl) avatarEl.textContent = getInitials(userName);

        // Populate team selector
        const teamSelect = document.getElementById('teamSelect');
        if (teamSelect && teams.length > 0) {
            // Check for saved team preference
            const savedTeam = localStorage.getItem('selected_team_id');
            teamSelect.innerHTML = teams.map(t =>
                '<option value="' + t.id + '"' + (savedTeam && parseInt(savedTeam) === t.id ? ' selected' : '') + '>' + t.name + '</option>'
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

        // Set welcome banner
        updateWelcomeBanner();

        // Load team data
        loadTeamData();
    }

    function updateWelcomeBanner() {
        const team = teams.find(t => t.id === currentTeamId);
        const titleEl = document.getElementById('welcomeTitle');
        const labelEl = document.getElementById('teamLabel');

        if (titleEl && userName) {
            titleEl.innerHTML = 'Welcome back, <em>' + userName.split(' ')[0] + '</em>';
        }
        if (labelEl && team) {
            labelEl.textContent = team.name;
        }
    }

    async function loadTeamData() {
        if (!currentTeamId) return;

        updateWelcomeBanner();

        // Load all team data in parallel
        const [stats, docs, chatHistory, roleData] = await Promise.all([
            api('/rag/stats/' + currentTeamId),
            api('/rag/documents/' + currentTeamId),
            api('/rag/chat/history/' + currentTeamId + '?limit=10'),
            api('/rag/my-role/' + currentTeamId),
        ]);

        renderStats(stats);
        renderCalendar(docs, chatHistory);
        renderTeamInfo(roleData);
        renderGettingStarted(stats, docs);
    }

    // ── Render Stats ──
    function renderStats(stats) {
        const docCount = document.getElementById('statDocuments');
        const chunkCount = document.getElementById('statChunks');

        if (docCount) docCount.textContent = stats ? stats.document_count : 0;
        if (chunkCount) chunkCount.textContent = stats ? stats.total_chunks.toLocaleString() : 0;
    }

    // ── Calendar ──
    let calView = 'month';
    let calDate = new Date();
    let calActivityDays = {};  // { 'YYYY-MM-DD': { docs: n, chats: n } }

    function renderCalendar(docs, chatHistory) {
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

        // Set up view toggle
        const toggle = document.getElementById('calendarViewToggle');
        if (toggle) {
            toggle.querySelectorAll('.calendar-view-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    toggle.querySelectorAll('.calendar-view-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    calView = btn.dataset.view;
                    drawCalendar();
                });
            });
        }

        // Nav buttons
        const prevBtn = document.getElementById('calPrev');
        const nextBtn = document.getElementById('calNext');
        const todayBtn = document.getElementById('calToday');

        if (prevBtn) prevBtn.addEventListener('click', () => { navCalendar(-1); });
        if (nextBtn) nextBtn.addEventListener('click', () => { navCalendar(1); });
        if (todayBtn) todayBtn.addEventListener('click', () => {
            calDate = new Date();
            drawCalendar();
        });

        drawCalendar();
    }

    function navCalendar(dir) {
        if (calView === 'month') {
            calDate.setMonth(calDate.getMonth() + dir);
        } else if (calView === 'week') {
            calDate.setDate(calDate.getDate() + dir * 7);
        } else {
            calDate.setDate(calDate.getDate() + dir);
        }
        drawCalendar();
    }

    function drawCalendar() {
        const grid = document.getElementById('calendarGrid');
        const label = document.getElementById('calLabel');
        if (!grid || !label) return;

        const today = new Date();
        const todayKey = today.toISOString().slice(0, 10);

        if (calView === 'month') {
            drawMonthView(grid, label, todayKey);
        } else if (calView === 'week') {
            drawWeekView(grid, label, todayKey);
        } else {
            drawDayView(grid, label, todayKey);
        }
    }

    function drawMonthView(grid, label, todayKey) {
        const year = calDate.getFullYear();
        const month = calDate.getMonth();
        label.textContent = calDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

        const firstDay = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const daysInPrev = new Date(year, month, 0).getDate();

        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        let html = '<div class="calendar__weekdays">';
        dayNames.forEach(d => html += `<div class="calendar__weekday">${d}</div>`);
        html += '</div><div class="calendar__days">';

        // Previous month padding
        for (let i = firstDay - 1; i >= 0; i--) {
            html += `<div class="calendar__day calendar__day--outside">${daysInPrev - i}</div>`;
        }

        // Current month
        for (let d = 1; d <= daysInMonth; d++) {
            const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const isToday = dateKey === todayKey;
            const activity = calActivityDays[dateKey];
            let classes = 'calendar__day';
            if (isToday) classes += ' calendar__day--today';
            if (activity) classes += ' calendar__day--has-activity';

            let dots = '';
            if (activity) {
                dots = '<div class="calendar__dots">';
                if (activity.docs > 0) dots += '<span class="calendar__dot calendar__dot--doc"></span>';
                if (activity.chats > 0) dots += '<span class="calendar__dot calendar__dot--chat"></span>';
                dots += '</div>';
            }

            html += `<div class="${classes}" data-date="${dateKey}"><span>${d}</span>${dots}</div>`;
        }

        // Next month padding
        const totalCells = firstDay + daysInMonth;
        const remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
        for (let i = 1; i <= remaining; i++) {
            html += `<div class="calendar__day calendar__day--outside">${i}</div>`;
        }

        html += '</div>';
        grid.innerHTML = html;
    }

    function drawWeekView(grid, label, todayKey) {
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
            const dateKey = day.toISOString().slice(0, 10);
            const isToday = dateKey === todayKey;
            const activity = calActivityDays[dateKey];

            let classes = 'calendar__week-day';
            if (isToday) classes += ' calendar__week-day--today';

            let activityHtml = '';
            if (activity) {
                if (activity.docs > 0) activityHtml += `<div class="calendar__week-event calendar__week-event--doc">📄 ${activity.docs} doc${activity.docs > 1 ? 's' : ''}</div>`;
                if (activity.chats > 0) activityHtml += `<div class="calendar__week-event calendar__week-event--chat">💬 ${activity.chats} chat${activity.chats > 1 ? 's' : ''}</div>`;
            }

            html += `<div class="${classes}">
                <div class="calendar__week-day-header">
                    <span class="calendar__week-day-name">${dayNames[i]}</span>
                    <span class="calendar__week-day-num${isToday ? ' calendar__week-day-num--today' : ''}">${day.getDate()}</span>
                </div>
                <div class="calendar__week-day-body">${activityHtml || '<span class="calendar__week-empty">—</span>'}</div>
            </div>`;
        }

        html += '</div>';
        grid.innerHTML = html;
    }

    function drawDayView(grid, label, todayKey) {
        const dateKey = calDate.toISOString().slice(0, 10);
        const isToday = dateKey === todayKey;
        const dayName = calDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
        label.textContent = dayName;

        const activity = calActivityDays[dateKey];

        let html = '<div class="calendar__day-view">';
        html += `<div class="calendar__day-view-date${isToday ? ' calendar__day-view-date--today' : ''}">${calDate.getDate()}</div>`;

        if (activity) {
            html += '<div class="calendar__day-view-events">';
            if (activity.docs > 0) {
                html += `<div class="calendar__day-view-event calendar__day-view-event--doc">
                    <span class="calendar__day-view-event-icon">📄</span>
                    <span>${activity.docs} document${activity.docs > 1 ? 's' : ''} uploaded</span>
                </div>`;
            }
            if (activity.chats > 0) {
                html += `<div class="calendar__day-view-event calendar__day-view-event--chat">
                    <span class="calendar__day-view-event-icon">💬</span>
                    <span>${activity.chats} AI conversation${activity.chats > 1 ? 's' : ''}</span>
                </div>`;
            }
            html += '</div>';
        } else {
            html += '<div class="calendar__day-view-empty">No activity on this day</div>';
        }

        html += '</div>';
        grid.innerHTML = html;
    }

    // ── Render Team Info (inside welcome banner) ──
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
                '<span class="team-info__value">' + team.name + '</span>' +
            '</div>' +
            '<div class="team-info__row">' +
                '<span class="team-info__label">Your Role</span>' +
                '<span class="team-info__value">' + roleLabel + '</span>' +
            '</div>';
    }

    // ── Getting Started (for empty KBs) ──
    function renderGettingStarted(stats, docs) {
        const card = document.getElementById('gettingStartedCard');
        if (!card) return;

        const hasDocs = docs && docs.documents && docs.documents.length > 0;
        const hasChunks = stats && stats.total_chunks > 0;

        // Show getting started only for empty teams
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
