document.addEventListener("DOMContentLoaded", () => {

    /* ── Element refs ── */
    const navLinks     = document.querySelectorAll(".stg-nav__link");
    const sections     = document.querySelectorAll(".stg-section");

    const profileForm  = document.getElementById("profileForm");
    const projectForm  = document.getElementById("projectForm");

    const toggleEmail     = document.getElementById("toggleEmail");
    const toggleDashboard = document.getElementById("toggleDashboard");
    const toggleDeadline  = document.getElementById("toggleDeadline");

    const sensitivitySlider = document.getElementById("sensitivitySlider");
    const sensitivityValue  = document.getElementById("sensitivityValue");

    const teamMembersList = document.getElementById("teamMembersList");

    const inviteModalOverlay = document.getElementById("inviteModalOverlay");
    const openInviteModalBtn = document.getElementById("openInviteModal");
    const inviteCancel       = document.getElementById("inviteCancel");
    const inviteCancelBtn    = document.getElementById("inviteCancelBtn");
    const inviteForm         = document.getElementById("inviteForm");

    const removeModalOverlay = document.getElementById("removeModalOverlay");
    const removeCancel       = document.getElementById("removeCancel");
    const removeCloseBtn     = document.getElementById("removeCloseBtn");
    const removeConfirmBtn   = document.getElementById("removeConfirmBtn");

    const copyInviteCodeBtn  = document.getElementById("copySettingsInviteCode");
    const inviteCodeDisplay  = document.getElementById("projectSettingsInviteCode");

    /* ── State ── */
    let userRole       = "viewer";
    let currentTeamId  = null;
    let currentUserData = null;

    /* ═══════════════════ INIT ═══════════════════ */

    async function init() {
        try {
            // 1. Profile
            const profileRes = await window.__lp.authFetch("/api/v1/profile-status");
            if (profileRes.status === 401 || profileRes.status === 403) throw new Error("auth");
            if (!profileRes.ok) { console.warn("Profile-status non-OK:", profileRes.status); return; }
            const profile = await profileRes.json();
            currentUserData = profile;

            document.getElementById("profileName").value  = profile.full_name || "";
            document.getElementById("profileEmail").value = profile.email || "";

            // Avatar initial
            const initial = (profile.full_name || profile.email || "U").charAt(0).toUpperCase();
            const avatarEl = document.getElementById("avatarInitial");
            if (avatarEl) avatarEl.textContent = initial;

            const dispName = document.getElementById("avatarDisplayName");
            if (dispName) dispName.textContent = profile.full_name || profile.email;

            setToggle(toggleEmail, !!profile.notify_email);
            setToggle(toggleDashboard, !!profile.notify_dashboard);
            setToggle(toggleDeadline, !!profile.notify_deadline);

            if (!profile.has_teams) { userRole = "viewer"; return; }

            // 2. Teams
            const teamsRes = await window.__lp.authFetch("/api/v1/onboarding/my-teams");
            if (!teamsRes.ok) return;
            const teamsData = await teamsRes.json();
            if (!teamsData.teams.length) return;

            const storedId = parseInt(localStorage.getItem("selected_team_id"));
            const activeTeam = teamsData.teams.find(t => t.id === storedId) || teamsData.teams[0];

            currentTeamId = activeTeam.id;
            localStorage.setItem("selected_team_id", currentTeamId);
            userRole = activeTeam.role;

            document.getElementById("projectName").value = activeTeam.team_name || "";
            document.getElementById("projectDesc").value = activeTeam.description || "";

            const roleDisp = document.getElementById("workspaceRoleDisplay");
            if (roleDisp) roleDisp.textContent = capitalize(userRole);
            const avatarRole = document.getElementById("avatarDisplayRole");
            if (avatarRole) avatarRole.textContent = capitalize(userRole);

            if (sensitivitySlider && activeTeam.ai_sensitivity !== undefined) {
                sensitivitySlider.value = activeTeam.ai_sensitivity;
                if (sensitivityValue) sensitivityValue.textContent = activeTeam.ai_sensitivity + "%";
            }

            if (inviteCodeDisplay && activeTeam.invite_code) {
                inviteCodeDisplay.textContent = activeTeam.invite_code;
            }

            await loadTeamMembers();

            // URL tab restore
            const tab = new URLSearchParams(window.location.search).get("tab");
            if (tab) {
                const link = document.querySelector(`.stg-nav__link[data-target="${tab}"]`);
                if (link) link.click();
            }
        } catch (e) {
            console.error(e);
            window.location.href = "/login";
        }
    }

    init();

    /* ═══════════════════ NAVIGATION ═══════════════════ */

    navLinks.forEach(link => {
        link.addEventListener("click", (e) => {
            e.preventDefault();
            const target = link.dataset.target;
            navLinks.forEach(l => l.classList.remove("active"));
            sections.forEach(s => s.classList.remove("active"));
            link.classList.add("active");
            const panel = document.getElementById(`section-${target}`);
            if (panel) panel.classList.add("active");
        });
    });

    /* ═══════════════════ PROFILE ═══════════════════ */

    profileForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const payload = {
            full_name: document.getElementById("profileName").value,
            email: document.getElementById("profileEmail").value
        };
        const res = await apiCall("/api/v1/settings/profile", "PUT", payload);
        if (res) {
            showToast("Profile updated", "success");
            const sbName = document.getElementById("sidebarUserName");
            if (sbName) sbName.textContent = payload.full_name;
            const dispName = document.getElementById("avatarDisplayName");
            if (dispName) dispName.textContent = payload.full_name;
            const avatarEl = document.getElementById("avatarInitial");
            if (avatarEl) avatarEl.textContent = (payload.full_name || "U").charAt(0).toUpperCase();
        }
    });

    /* ═══════════════════ TOGGLES ═══════════════════ */

    function setToggle(el, on) {
        if (!el) return;
        el.setAttribute("aria-checked", on ? "true" : "false");
    }

    function attachToggle(el, field) {
        if (!el) return;
        el.addEventListener("click", async () => {
            const next = el.getAttribute("aria-checked") !== "true";
            setToggle(el, next);
            const payload = {};
            payload[field] = next;
            await apiCall("/api/v1/settings/profile", "PUT", payload);
        });
    }

    attachToggle(toggleEmail, "notify_email");
    attachToggle(toggleDashboard, "notify_dashboard");
    attachToggle(toggleDeadline, "notify_deadline");

    /* ═══════════════════ AI SENSITIVITY ═══════════════════ */

    if (sensitivitySlider) {
        sensitivitySlider.addEventListener("input", (e) => {
            if (sensitivityValue) sensitivityValue.textContent = e.target.value + "%";
        });
        sensitivitySlider.addEventListener("change", async (e) => {
            if (!currentTeamId) return;
            const val = parseInt(e.target.value);
            const res = await apiCall(`/api/v1/settings/teams/${currentTeamId}`, "PUT", { ai_sensitivity: val });
            if (res) showToast("AI sensitivity updated", "success");
        });
    }

    /* ═══════════════════ PROJECT ═══════════════════ */

    projectForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!currentTeamId) return;
        const payload = {
            team_name: document.getElementById("projectName").value,
            description: document.getElementById("projectDesc").value
        };
        const res = await apiCall(`/api/v1/settings/teams/${currentTeamId}`, "PUT", payload);
        if (res) {
            showToast("Workspace updated", "success");
            setTimeout(() => window.location.reload(), 500);
        }
    });

    /* ═══════════════════ TEAM MEMBERS ═══════════════════ */

    async function loadTeamMembers() {
        if (!currentTeamId) return;
        const res = await apiCall(`/api/v1/settings/teams/${currentTeamId}/members`, "GET");
        if (res && res.members) renderMembers(res.members);
    }

    const avatarPalette = [
        { bg: "#e0e7ff", fg: "#4f46e5" },
        { bg: "#ffedd5", fg: "#ea580c" },
        { bg: "#d1fae5", fg: "#059669" },
        { bg: "#fce7f3", fg: "#db2777" },
        { bg: "#f1f5f9", fg: "#475569" },
    ];

    function renderMembers(members) {
        teamMembersList.innerHTML = "";
        const isOwner = userRole === "owner";

        members.forEach(m => {
            const isSelf = m.email === currentUserData?.email;
            const c = avatarPalette[m.id % avatarPalette.length];
            const initials = (m.full_name || m.email || "U").charAt(0).toUpperCase();

            const row = document.createElement("div");
            row.className = "stg-member";

            row.innerHTML = `
                <div class="stg-member__user">
                    <div class="stg-member__avatar" style="background:${c.bg};color:${c.fg};">${initials}</div>
                    <div style="min-width:0;">
                        <div class="stg-member__name">${escapeHtml(m.full_name)}${isSelf ? ' <span style="color:var(--color-text-muted);font-weight:400;">(you)</span>' : ''}</div>
                        <div class="stg-member__email">${escapeHtml(m.email)}</div>
                    </div>
                </div>
                <div>
                    <select class="stg-member__role-select" data-id="${m.id}" ${(!isOwner || isSelf) ? 'disabled' : ''}>
                        <option value="owner" ${m.role === 'owner' ? 'selected' : ''}>Owner</option>
                        <option value="editor" ${m.role === 'editor' ? 'selected' : ''}>Editor</option>
                        <option value="viewer" ${m.role === 'viewer' ? 'selected' : ''}>Viewer</option>
                    </select>
                </div>
                <div>
                    <button class="stg-member__remove" data-id="${m.id}" data-name="${escapeHtml(m.full_name)}" ${(isSelf || !isOwner) ? 'disabled' : ''} title="Remove member">
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                    </button>
                </div>
            `;

            teamMembersList.appendChild(row);
        });

        // Role change handlers
        teamMembersList.querySelectorAll(".stg-member__role-select").forEach(sel => {
            sel.addEventListener("change", async (e) => {
                const userId = sel.dataset.id;
                const res = await apiCall(`/api/v1/settings/teams/${currentTeamId}/roles/${userId}`, "PUT", { role_name: e.target.value });
                if (res) {
                    showToast(`Role updated to ${capitalize(e.target.value)}`, "success");
                }
                loadTeamMembers();
            });
        });

        // Remove handlers
        teamMembersList.querySelectorAll(".stg-member__remove").forEach(btn => {
            btn.addEventListener("click", () => {
                document.getElementById("removeMemberId").value = btn.dataset.id;
                document.getElementById("removeMemberName").textContent = btn.dataset.name;
                removeModalOverlay.classList.add("active");
            });
        });
    }

    /* ═══════════════════ INVITE CODE ═══════════════════ */

    if (copyInviteCodeBtn) {
        copyInviteCodeBtn.addEventListener("click", () => {
            const code = inviteCodeDisplay.textContent;
            if (code && code !== "--------") {
                navigator.clipboard.writeText(code).then(() => showToast("Invite code copied", "success"));
            }
        });
    }

    /* ═══════════════════ MODALS ═══════════════════ */

    function closeModal(overlay) { overlay.classList.remove("active"); }

    openInviteModalBtn.addEventListener("click", () => inviteModalOverlay.classList.add("active"));
    inviteCancel.addEventListener("click", () => closeModal(inviteModalOverlay));
    inviteCancelBtn.addEventListener("click", () => closeModal(inviteModalOverlay));

    inviteForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const payload = {
            email: document.getElementById("inviteEmail").value,
            role: document.getElementById("inviteRole").value
        };
        const res = await apiCall(`/api/v1/settings/teams/${currentTeamId}/invites`, "POST", payload);
        if (res) {
            showToast("Invite sent!", "success");
            closeModal(inviteModalOverlay);
            inviteForm.reset();
            loadTeamMembers();
        }
    });

    removeCancel.addEventListener("click", () => closeModal(removeModalOverlay));
    removeCloseBtn.addEventListener("click", () => closeModal(removeModalOverlay));

    removeConfirmBtn.addEventListener("click", async () => {
        const userId = document.getElementById("removeMemberId").value;
        const res = await apiCall(`/api/v1/settings/teams/${currentTeamId}/members/${userId}`, "DELETE");
        if (res) {
            showToast("Member removed", "success");
            closeModal(removeModalOverlay);
            loadTeamMembers();
        }
    });

    /* ═══════════════════ UTILITIES ═══════════════════ */

    async function apiCall(endpoint, method, body = null) {
        const opts = { method, headers: {} };
        if (body) {
            opts.headers["Content-Type"] = "application/json";
            opts.body = JSON.stringify(body);
        }
        try {
            const r = await window.__lp.authFetch(endpoint, opts);
            if (!r.ok) {
                const err = await r.json().catch(() => ({}));
                showToast(err.detail || "Something went wrong", "error");
                return null;
            }
            return await r.json();
        } catch {
            showToast("Network error — could not reach server", "error");
            return null;
        }
    }

    function showToast(message, type = "success") {
        const el = document.createElement("div");
        el.className = `stg-toast stg-toast--${type}`;
        el.textContent = message;
        document.body.appendChild(el);
        setTimeout(() => {
            el.style.opacity = "0";
            el.style.transition = "opacity 0.3s";
            setTimeout(() => el.remove(), 300);
        }, 3000);
    }

    function capitalize(s) {
        return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
    }

    function escapeHtml(str) {
        if (!str) return "";
        const d = document.createElement("div");
        d.textContent = str;
        return d.innerHTML;
    }
});
