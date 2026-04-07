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

    document.getElementById('navbarLogoutBtn')?.addEventListener('click', () => {
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
    // ── Sidebar team / project select ──
    const _ts = document.getElementById('teamSelect');
    if (_ts) {
        // Persist selection on change
        _ts.addEventListener('change', function () {
            localStorage.setItem('selected_team_id', _ts.value);
            window.location.reload();
        });

        // Fallback loader — populate if page JS hasn't done it yet
        authFetch('/api/v1/onboarding/my-teams')
            .then(function (r) { return r && r.ok ? r.json() : null; })
            .then(function (data) {
                // Skip if page-specific JS already populated the select
                if (_ts.options.length > 1 || (_ts.options[0] && !_ts.options[0].textContent.includes('Loading'))) return;

                if (!data || !data.teams || data.teams.length === 0) {
                    _ts.innerHTML = '<option>No projects yet</option>';
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
            })
            .catch(function () {});
    }
})();
