/* ═══════════════════════════════════════════════════════════════
   LogiPlanner — Shared Base Script
   Runs on every page that extends base.html.
   ═══════════════════════════════════════════════════════════════ */

(function () {
    // ── Auth Guard: promote token from URL param ──
    const urlParams = new URLSearchParams(window.location.search);
    const urlToken = urlParams.get('token');
    if (urlToken) {
        localStorage.setItem('access_token', urlToken);
        window.history.replaceState({}, document.title, window.location.pathname);
    }

    const token = localStorage.getItem('access_token');
    if (!token) {
        window.location.href = '/login';
        return;
    }

    // ── Logout ──
    document.getElementById('logoutBtn')?.addEventListener('click', () => {
        localStorage.removeItem('access_token');
        window.location.href = '/login';
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
    fetch('/api/v1/auth/me', {
        headers: { 'Authorization': 'Bearer ' + token }
    })
        .then(r => r.ok ? r.json() : null)
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
            }
        })
        .catch(() => {});
})();
