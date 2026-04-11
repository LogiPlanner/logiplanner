/* ═══════════════════════════════════════════════════════════════
   LogiPlanner — Shared Base Script
   Runs on every page that extends base.html.
   ═══════════════════════════════════════════════════════════════ */

(function () {

    // ── Token helpers ──
    function forceLogout() {
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        sessionStorage.removeItem('lp_pending_setup');
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
    document.getElementById('navbarLogoutBtn')?.addEventListener('click', () => forceLogout());
    document.getElementById('logoutBtn')?.addEventListener('click', () => forceLogout());

    // ── Create Project (navbar) ──
    document.getElementById('navCreateProjectBtn')?.addEventListener('click', function() {
        window.location.href = '/settings?section=create-project';
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

    // ── Team colors palette ──
    var _teamColors = ['#4f46e5','#7c3aed','#06d6a0','#f59e0b','#ef4444','#3b82f6','#ec4899','#14b8a6'];

    // ── Hidden team select (kept for page-script compat) ──
    var _ts = document.getElementById('teamSelect');

    // ── Notification bell toggle ──
    var _notifBtn = document.getElementById('notifBtn');
    var _notifDropdown = document.getElementById('notifDropdown');
    if (_notifBtn && _notifDropdown) {
        _notifBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            var open = _notifDropdown.style.display !== 'none';
            _notifDropdown.style.display = open ? 'none' : 'block';
        });
        document.addEventListener('click', function(e) {
            if (!_notifDropdown.contains(e.target) && e.target !== _notifBtn) {
                _notifDropdown.style.display = 'none';
            }
        });
    }

    // ── User Avatar dropdown toggle ──
    var _avatarBtn = document.getElementById('userAvatarBtn');
    var _userDropdown = document.getElementById('userDropdown');
    if (_avatarBtn && _userDropdown) {
        _avatarBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            var isVisible = _userDropdown.style.opacity === '1' || _userDropdown.style.visibility === 'visible';
            if (isVisible) {
                _userDropdown.style.opacity = '0';
                _userDropdown.style.visibility = 'hidden';
                _userDropdown.style.transform = 'translateY(-8px)';
            } else {
                _userDropdown.style.opacity = '1';
                _userDropdown.style.visibility = 'visible';
                _userDropdown.style.transform = 'translateY(0)';
            }
        });
        document.addEventListener('click', function(e) {
            if (!_avatarBtn.contains(e.target)) {
                _userDropdown.style.opacity = '0';
                _userDropdown.style.visibility = 'hidden';
                _userDropdown.style.transform = 'translateY(-8px)';
            }
        });
    }

    // ── Subteam dropdown toggle ──
    var _subteamBtn  = document.getElementById('subteamDropdownBtn');
    var _subteamMenu = document.getElementById('subteamMenu');
    if (_subteamBtn && _subteamMenu) {
        _subteamBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            var open = _subteamMenu.style.display !== 'none';
            _subteamMenu.style.display = open ? 'none' : 'block';
        });
        document.addEventListener('click', function(e) {
            if (!_subteamBtn.contains(e.target) && !_subteamMenu.contains(e.target)) {
                _subteamMenu.style.display = 'none';
            }
        });
    }

    // ── Render Projects list in navbar dropdown (teams = UI "projects") ──
    function _renderNavProjects(teams) {
        var container = document.getElementById('navProjectsList');
        if (!container) return;
        var selectedId = parseInt(localStorage.getItem('selected_team_id') || '0');
        container.innerHTML = '';
        teams.forEach(function(t, i) {
            var id = t.id || t.team_id;
            var name = t.team_name || t.name || 'Project';
            var color = _teamColors[i % _teamColors.length];
            var btn = document.createElement('button');
            btn.className = 'topbar__project-btn' + (id === selectedId ? ' active' : '');
            btn.dataset.teamId = id;
            btn.innerHTML = '<span class="topbar__project-dot" style="background:' + color + '"></span>' + _escHtml(name);
            btn.addEventListener('click', function() {
                localStorage.setItem('selected_team_id', id);
                localStorage.removeItem('selected_subteam_id');
                // Update hidden select for page-script compat
                if (_ts) {
                    for (var j = 0; j < _ts.options.length; j++) {
                        if (parseInt(_ts.options[j].value) === id) {
                            _ts.selectedIndex = j;
                            _ts.dispatchEvent(new Event('change'));
                            break;
                        }
                    }
                }
                // Close dropdown and reload page to reflect new project
                if (_userDropdown) {
                    _userDropdown.style.opacity = '0';
                    _userDropdown.style.visibility = 'hidden';
                }
                _renderNavProjects(teams);
                if (!_ts) {
                    window.dispatchEvent(new CustomEvent('teamchange', { detail: { id: id, name: name } }));
                }
            });
            container.appendChild(btn);
        });
    }

    // ── Render SubTeam options in sidebar dropdown (subteams = UI "teams") ──
    function _renderSubteamOpts(subteams) {
        if (!_subteamMenu) return;
        var selectedId = localStorage.getItem('selected_subteam_id') || 'all';
        _subteamMenu.innerHTML = '';

        // "All Teams" option
        var allBtn = document.createElement('button');
        allBtn.className = 'sidebar__subteam-opt' + (selectedId === 'all' ? ' active' : '');
        allBtn.dataset.subteamId = 'all';
        allBtn.innerHTML = '<span class="sidebar__subteam-dot" style="background:#9ca3af"></span>All Teams';
        allBtn.addEventListener('click', function() {
            _selectSubteam('all', 'All Teams');
        });
        _subteamMenu.appendChild(allBtn);

        subteams.forEach(function(st, i) {
            var color = st.color || _teamColors[i % _teamColors.length];
            var btn = document.createElement('button');
            btn.className = 'sidebar__subteam-opt' + (parseInt(selectedId) === st.id ? ' active' : '');
            btn.dataset.subteamId = st.id;
            btn.innerHTML = '<span class="sidebar__subteam-dot" style="background:' + _escHtml(color) + '"></span>' + _escHtml(st.name);
            btn.addEventListener('click', function() {
                _selectSubteam(st.id, st.name);
            });
            _subteamMenu.appendChild(btn);
        });
    }

    function _selectSubteam(id, name) {
        localStorage.setItem('selected_subteam_id', id);
        var nameEl = document.getElementById('activeSubteamName');
        if (nameEl) nameEl.textContent = name;
        if (_subteamMenu) _subteamMenu.style.display = 'none';
        // Update active states
        if (_subteamMenu) {
            _subteamMenu.querySelectorAll('.sidebar__subteam-opt').forEach(function(b) {
                b.classList.toggle('active', String(b.dataset.subteamId) === String(id));
            });
        }
        window.dispatchEvent(new CustomEvent('subteamchange', { detail: { id: id, name: name } }));
    }

    // ── Load subteams for current team ──
    function _loadSubteams(teamId) {
        if (!teamId || !_subteamMenu) return;
        authFetch('/api/v1/settings/teams/' + teamId + '/subteams')
            .then(function(r) { return r && r.ok ? r.json() : null; })
            .then(function(data) {
                _renderSubteamOpts(data && data.subteams ? data.subteams : []);
                // Restore saved subteam name
                var savedId = localStorage.getItem('selected_subteam_id') || 'all';
                var nameEl = document.getElementById('activeSubteamName');
                if (nameEl) {
                    if (savedId === 'all') {
                        nameEl.textContent = 'All Teams';
                    } else if (data && data.subteams) {
                        var found = data.subteams.find(function(s) { return String(s.id) === String(savedId); });
                        if (found) nameEl.textContent = found.name;
                    }
                }
            })
            .catch(function() {});
    }

    function _escHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // ── Load user info → set initials + dropdown name/email ──
    authFetch('/api/v1/profile-status')
        .then(function(r) { return r && r.ok ? r.json() : null; })
        .then(function(d) {
            if (!d) return;
            var name = d.full_name || '';
            var email = d.email || '';
            var displayName = name || email;
            var initials = displayName.trim().split(/\s+/).slice(0, 2).map(function(p) { return p[0].toUpperCase(); }).join('') || 'U';
            var avatarEl = document.getElementById('avatarInitials');
            if (avatarEl) avatarEl.textContent = initials;
            var nameEl = document.getElementById('navUserName');
            if (nameEl) nameEl.textContent = name || email || 'User';
            var emailEl = document.getElementById('navUserEmail');
            if (emailEl) {
                emailEl.textContent = email;
                emailEl.style.display = email ? '' : 'none';
            }
        })
        .catch(function() {});

    // ── Load teams → populate navbar projects + sidebar subteams ──
    authFetch('/api/v1/onboarding/my-teams')
        .then(function(r) { return r && r.ok ? r.json() : null; })
        .then(function(data) {
            if (!data || !data.teams || data.teams.length === 0) return;

            var teams = data.teams;
            var saved = localStorage.getItem('selected_team_id');
            var selectedTeamId = saved ? parseInt(saved) : null;

            // Auto-select first team if none saved
            if (!selectedTeamId && teams.length > 0) {
                selectedTeamId = teams[0].id || teams[0].team_id;
                localStorage.setItem('selected_team_id', selectedTeamId);
            }

            // Populate hidden select (page-script compat)
            if (_ts) {
                if (_ts.options.length <= 1 && _ts.options[0] && _ts.options[0].textContent.includes('Loading')) {
                    _ts.innerHTML = '';
                    teams.forEach(function(t) {
                        var opt = document.createElement('option');
                        opt.value = t.id || t.team_id;
                        opt.textContent = t.team_name || t.name;
                        if (parseInt(opt.value) === selectedTeamId) opt.selected = true;
                        _ts.appendChild(opt);
                    });
                    if (!_ts.value) _ts.selectedIndex = 0;
                }
                _ts.addEventListener('change', function() {
                    localStorage.setItem('selected_team_id', _ts.value);
                    _loadSubteams(_ts.value);
                    window.dispatchEvent(new CustomEvent('teamchange', { detail: { id: _ts.value, name: _ts.options[_ts.selectedIndex] ? _ts.options[_ts.selectedIndex].textContent : '' } }));
                });
            }

            // Render navbar project list
            _renderNavProjects(teams);

            // Load subteams for currently selected team
            _loadSubteams(selectedTeamId);
        })
        .catch(function() {});

})();
