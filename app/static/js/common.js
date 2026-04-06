/* ═══════════════════════════════════════════════════════════════
   LogiPlanner — Shared Base Script
   Runs on every page that extends base.html.
   ═══════════════════════════════════════════════════════════════ */

(function () {

    // ── Token helpers ──
    function forceLogout() {
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        window.location.href = '/login';
    }

    async function tryRefresh() {
        const rt = localStorage.getItem('refresh_token');
        if (!rt) return false;
        try {
            const res = await fetch('/api/v1/refresh', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refresh_token: rt }),
            });
            if (!res.ok) return false;
            const data = await res.json();
            localStorage.setItem('access_token', data.access_token);
            localStorage.setItem('refresh_token', data.refresh_token);
            return true;
        } catch { return false; }
    }

    /** Fetch with automatic token refresh on 401. */
    async function authFetch(url, opts = {}) {
        const token = localStorage.getItem('access_token');
        if (!opts.headers) opts.headers = {};
        if (token) opts.headers['Authorization'] = 'Bearer ' + token;

        let res = await fetch(url, opts);
        if (res.status === 401) {
            const ok = await tryRefresh();
            if (ok) {
                opts.headers['Authorization'] = 'Bearer ' + localStorage.getItem('access_token');
                res = await fetch(url, opts);
            } else {
                forceLogout();
                return res;
            }
        }
        return res;
    }

    // Expose globally for page scripts
    window.__lp = { authFetch, forceLogout };

    // ── Auth Guard: promote token from URL param ──
    const urlParams = new URLSearchParams(window.location.search);
    const urlToken = urlParams.get('token');
    const urlRefresh = urlParams.get('refresh_token');
    if (urlToken) {
        localStorage.setItem('access_token', urlToken);
        if (urlRefresh) localStorage.setItem('refresh_token', urlRefresh);
        window.history.replaceState({}, document.title, window.location.pathname);
    }

    const token = localStorage.getItem('access_token');
    if (!token) {
        window.location.href = '/login';
        return;
    }

    // ── Logout ──
    document.getElementById('logoutBtn')?.addEventListener('click', () => {
        forceLogout();
    });

    // ── Mobile Sidebar Toggle ──
    const toggle  = document.getElementById('mobileToggle');
    const sidebar = document.getElementById('mainSidebar');
    const overlay = document.getElementById('sidebarOverlay');

    if (toggle && sidebar) {
        toggle.addEventListener('click', () => {
            sidebar.classList.toggle('open');
            overlay?.classList.toggle('active');
        });
    }

    if (overlay) {
        overlay.addEventListener('click', () => {
            sidebar.classList.remove('open');
            overlay.classList.remove('active');
        });
    }

    // ── Populate sidebar user pill ──
    authFetch('/api/v1/auth/me')
        .then(r => r && r.ok ? r.json() : null)
        .then(d => {
            if (!d) return;
            const name = d.full_name || d.email || '';
            const role = d.role || '';

            const userEl = document.getElementById('sidebarUser');
            if (userEl) userEl.style.display = 'flex';

            const nameEl = document.getElementById('sidebarUserName');
            if (nameEl) nameEl.textContent = name;

            const roleEl = document.getElementById('sidebarUserRole');
            if (roleEl) roleEl.textContent = role;

            const avatarEl = document.getElementById('sidebarAvatar');
            if (avatarEl) {
                const initials = name.trim().split(/\s+/).slice(0, 2).map(p => p[0].toUpperCase()).join('');
                avatarEl.textContent = initials || 'U';

                const topbarAvatarEl = document.getElementById('avatarInitials');
                if (topbarAvatarEl) {
                    topbarAvatarEl.textContent = initials || 'U';
                }
            }
        })
        .catch(() => {});
    // ── Sidebar team / project list ──
    var _teamColors = ['#4f46e5','#7c3aed','#06d6a0','#f59e0b','#ef4444','#3b82f6','#ec4899','#14b8a6'];
    var _ts = document.getElementById('teamSelect');
    var _tl = document.getElementById('teamList');

    function _renderTeamBtns(teams, selectedId) {
        if (!_tl) return;
        if (!teams || teams.length === 0) {
            _tl.innerHTML = '<div class="sidebar__teams-empty">No projects yet</div>';
            return;
        }
        _tl.innerHTML = '';
        teams.forEach(function (t, i) {
            var id = t.id || t.team_id;
            var name = t.team_name || t.name || 'Team';
            var initials = name.split(' ').map(function(w){return w[0]}).join('').toUpperCase().slice(0,2);
            var color = _teamColors[i % _teamColors.length];

            var btn = document.createElement('button');
            btn.className = 'sidebar__team-btn' + (parseInt(selectedId) === id ? ' active' : '');
            btn.dataset.teamId = id;
            btn.innerHTML = '<span class="sidebar__team-icon" style="background:' + color + '">' + initials + '</span>'
                + '<span class="sidebar__team-name">' + name + '</span>';
            btn.addEventListener('click', function () {
                // Update hidden select
                if (_ts) { _ts.value = id; _ts.dispatchEvent(new Event('change')); }
                // Update active state
                _tl.querySelectorAll('.sidebar__team-btn').forEach(function(b){ b.classList.remove('active'); });
                btn.classList.add('active');
            });
            _tl.appendChild(btn);
        });
    }

    if (_ts) {
        // Persist selection on change
        _ts.addEventListener('change', function () {
            localStorage.setItem('selected_team_id', _ts.value);
            // Sync button active state
            if (_tl) {
                _tl.querySelectorAll('.sidebar__team-btn').forEach(function(b){
                    b.classList.toggle('active', b.dataset.teamId === _ts.value);
                });
            }
        });

        // Fallback loader — populate if page JS hasn't done it yet
        authFetch('/api/v1/onboarding/my-teams')
            .then(function (r) { return r && r.ok ? r.json() : null; })
            .then(function (data) {
                // Skip if page-specific JS already populated the select
                if (_ts.options.length > 1 || (_ts.options[0] && _ts.options[0].textContent !== 'Loading teams...')) return;

                if (!data || !data.teams || data.teams.length === 0) {
                    _ts.innerHTML = '<option>No teams yet</option>';
                    _renderTeamBtns(null);
                    return;
                }
                var saved = localStorage.getItem('selected_team_id');
                _ts.innerHTML = '';
                data.teams.forEach(function (t) {
                    var opt = document.createElement('option');
                    opt.value = t.id;
                    opt.textContent = t.team_name;
                    opt.dataset.role = t.role || 'viewer';
                    if (saved && parseInt(saved) === t.id) opt.selected = true;
                    _ts.appendChild(opt);
                });
                if (!_ts.value) _ts.selectedIndex = 0;
                localStorage.setItem('selected_team_id', _ts.value);
                _renderTeamBtns(data.teams, _ts.value);
            })
            .catch(function () {});

        // Auto-render team buttons when page-specific JS populates the select
        if (_tl) {
            var _obs = new MutationObserver(function () {
                // Skip if still loading or buttons already rendered by page JS
                if (_ts.options.length === 0) return;
                if (_ts.options[0].textContent === 'Loading teams...' || _ts.options[0].textContent === 'No teams yet') return;
                if (_tl.querySelector('.sidebar__team-btn')) return;
                var _teams = [];
                for (var i = 0; i < _ts.options.length; i++) {
                    var val = parseInt(_ts.options[i].value);
                    if (!isNaN(val)) _teams.push({ id: val, team_name: _ts.options[i].textContent });
                }
                if (_teams.length > 0) _renderTeamBtns(_teams, _ts.value);
            });
            _obs.observe(_ts, { childList: true });
        }
    }
})();
