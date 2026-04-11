document.addEventListener("DOMContentLoaded", () => {

    /* ── Element refs ── */
    const navLinks     = document.querySelectorAll(".stg-nav__link");
    const sections     = document.querySelectorAll(".stg-section");

    const projectForm       = document.getElementById("projectForm");

    const toggleEmail     = document.getElementById("toggleEmail");
    const toggleDashboard = document.getElementById("toggleDashboard");
    const toggleDeadline  = document.getElementById("toggleDeadline");

    /* ── State ── */
    let userRole      = "viewer";
    let currentTeamId = null;

    /* ═══════════════════ INIT ═══════════════════ */

    async function init() {
        try {
            // 1. Profile data (for notification toggles)
            const profileRes = await window.__lp.authFetch("/api/v1/profile-status");
            if (!profileRes.ok) { window.location.href = "/login"; return; }
            const profile = await profileRes.json();

            setToggle(toggleEmail,     !!profile.notify_email);
            setToggle(toggleDashboard, !!profile.notify_dashboard);
            setToggle(toggleDeadline,  !!profile.notify_deadline);

            // 2. Teams → load project settings
            const teamsRes = await window.__lp.authFetch("/api/v1/onboarding/my-teams");
            if (!teamsRes.ok) return;
            const teamsData = await teamsRes.json();
            if (!teamsData.teams || !teamsData.teams.length) return;

            const storedId  = parseInt(localStorage.getItem("selected_team_id"));
            const activeTeam = teamsData.teams.find(t => t.id === storedId) || teamsData.teams[0];

            currentTeamId = activeTeam.id;
            localStorage.setItem("selected_team_id", currentTeamId);
            userRole = activeTeam.role || "viewer";

            // Fill general form
            const nameInput = document.getElementById("projectName");
            const descInput = document.getElementById("projectDesc");
            if (nameInput) nameInput.value = activeTeam.team_name || "";
            if (descInput) descInput.value = activeTeam.description || "";

            // Subtitle
            const subtitle = document.getElementById("settingsSubtitle");
            if (subtitle) subtitle.textContent = (activeTeam.team_name || "Project") + " Configuration";

            // Enable delete button only for owner
            const deleteBtn = document.getElementById("deleteProjectBtn");
            if (deleteBtn && userRole === "owner") {
                deleteBtn.disabled = false;
                deleteBtn.classList.remove("stg-btn--gray");
                deleteBtn.classList.add("stg-btn--danger");
            }

            // Load subteams
            await loadSubteams();

            // URL tab restore
            const tab = new URLSearchParams(window.location.search).get("section") || new URLSearchParams(window.location.search).get("tab");
            if (tab) {
                const link = document.querySelector(`.stg-nav__link[data-target="${tab}"]`);
                if (link) link.click();
            }

        } catch (e) {
            console.error(e);
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

    /* ═══════════════════ GENERAL (Project Settings) ═══════════════════ */

    if (projectForm) {
        projectForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            if (!currentTeamId) return;
            const payload = {
                team_name: document.getElementById("projectName").value,
                description: document.getElementById("projectDesc").value
            };
            const res = await apiCall(`/api/v1/settings/teams/${currentTeamId}`, "PUT", payload);
            if (res) {
                showToast("Project settings saved", "success");
                const subtitle = document.getElementById("settingsSubtitle");
                if (subtitle) subtitle.textContent = (payload.team_name || "Project") + " Configuration";
            }
        });
    }

    /* ═══════════════════ NOTIFICATION TOGGLES ═══════════════════ */

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

    attachToggle(toggleEmail,     "notify_email");
    attachToggle(toggleDashboard, "notify_dashboard");
    attachToggle(toggleDeadline,  "notify_deadline");

    /* ═══════════════════ SUBTEAM MANAGEMENT (Team Management tab) ═══════════════════ */

    let editingSubteamId = null;

    async function loadSubteams() {
        if (!currentTeamId) return;
        const res = await apiCall(`/api/v1/settings/teams/${currentTeamId}/subteams`, "GET");
        if (res && res.subteams !== undefined) {
            renderSubteamList(res.subteams);
        }
    }

    const subteamColors = ['#4f46e5','#7c3aed','#06d6a0','#f59e0b','#ef4444','#3b82f6','#ec4899','#14b8a6'];
    const avatarPalette = [
        { bg: "#e0e7ff", fg: "#4f46e5" },
        { bg: "#f5f3ff", fg: "#7c3aed" },
        { bg: "#ccfbf1", fg: "#059669" },
        { bg: "#fef3c7", fg: "#d97706" },
        { bg: "#fee2e2", fg: "#dc2626" },
        { bg: "#dbeafe", fg: "#2563eb" },
        { bg: "#fce7f3", fg: "#db2777" },
        { bg: "#ccfbf1", fg: "#0d9488" },
    ];

    function renderSubteamList(subteams) {
        const list = document.getElementById("subteamList");
        const emptyState = document.getElementById("subteamEmptyState");
        if (!list) return;

        // Remove existing cards (keep empty state)
        list.querySelectorAll(".stg-subteam-card").forEach(el => el.remove());

        if (!subteams || subteams.length === 0) {
            if (emptyState) emptyState.style.display = "";
            return;
        }

        if (emptyState) emptyState.style.display = "none";

        subteams.forEach((st, i) => {
            const color = st.color || subteamColors[i % subteamColors.length];
            const palette = avatarPalette[i % avatarPalette.length];
            const initials = (st.name || "T").split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);

            const card = document.createElement("div");
            card.className = "stg-subteam-card";
            card.dataset.subteamId = st.id;
            card.innerHTML = `
                <div class="stg-subteam-card__avatar" style="background:${palette.bg};color:${palette.fg};">${escapeHtml(initials)}</div>
                <div class="stg-subteam-card__info">
                    <span class="stg-subteam-card__name">${escapeHtml(st.name)}</span>
                    <span class="stg-subteam-card__meta">${st.member_count || 0} member${st.member_count !== 1 ? 's' : ''}</span>
                </div>
                <button class="stg-subteam-card__manage" data-subteam-id="${st.id}">Manage Members</button>
                <button class="stg-subteam-card__delete" data-subteam-id="${st.id}" data-name="${escapeHtml(st.name)}" title="Delete team">
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                </button>
            `;

            card.querySelector(".stg-subteam-card__delete").addEventListener("click", (e) => {
                e.stopPropagation();
                const btn = e.currentTarget;
                document.getElementById("deleteSubteamId").value = btn.dataset.subteamId;
                document.getElementById("deleteSubteamName").textContent = btn.dataset.name;
                openModal("deleteSubteamOverlay");
            });

            card.querySelector(".stg-subteam-card__manage").addEventListener("click", () => {
                openManageMembers(st.id, st.name);
            });

            list.appendChild(card);
        });
    }

    // Create Team button
    const createSubteamBtn = document.getElementById("createSubteamBtn");
    if (createSubteamBtn) {
        createSubteamBtn.addEventListener("click", () => {
            editingSubteamId = null;
            document.getElementById("subteamModalTitle").textContent = "Create Team";
            document.getElementById("subteamSubmitBtn").textContent = "Create Team";
            document.getElementById("subteamForm").reset();
            document.getElementById("subteamColor").value = "#4f46e5";
            document.querySelectorAll(".stg-color-swatch").forEach(s => s.classList.remove("active"));
            const firstSwatch = document.querySelector(".stg-color-swatch");
            if (firstSwatch) firstSwatch.classList.add("active");
            openModal("subteamModalOverlay");
        });
    }

    // Color swatches
    document.querySelectorAll(".stg-color-swatch").forEach(swatch => {
        swatch.addEventListener("click", () => {
            document.querySelectorAll(".stg-color-swatch").forEach(s => s.classList.remove("active"));
            swatch.classList.add("active");
            document.getElementById("subteamColor").value = swatch.dataset.color;
        });
    });

    // Subteam form submit
    const subteamForm = document.getElementById("subteamForm");
    if (subteamForm) {
        subteamForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            const payload = {
                name:        document.getElementById("subteamName").value,
                description: document.getElementById("subteamDescription").value,
                color:       document.getElementById("subteamColor").value
            };
            let res;
            if (editingSubteamId) {
                res = await apiCall(`/api/v1/settings/teams/${currentTeamId}/subteams/${editingSubteamId}`, "PUT", payload);
            } else {
                res = await apiCall(`/api/v1/settings/teams/${currentTeamId}/subteams`, "POST", payload);
            }
            if (res) {
                showToast(editingSubteamId ? "Team updated" : "Team created", "success");
                closeModal("subteamModalOverlay");
                await loadSubteams();
            }
        });
    }

    // Subteam modal close
    document.getElementById("subteamModalClose")?.addEventListener("click", () => closeModal("subteamModalOverlay"));
    document.getElementById("subteamCancelBtn")?.addEventListener("click", () => closeModal("subteamModalOverlay"));

    // Delete subteam confirm
    document.getElementById("deleteSubteamConfirm")?.addEventListener("click", async () => {
        const id = document.getElementById("deleteSubteamId").value;
        const res = await apiCall(`/api/v1/settings/teams/${currentTeamId}/subteams/${id}`, "DELETE");
        if (res) {
            showToast("Team deleted", "success");
            closeModal("deleteSubteamOverlay");
            await loadSubteams();
        }
    });
    document.getElementById("deleteSubteamClose")?.addEventListener("click", () => closeModal("deleteSubteamOverlay"));
    document.getElementById("deleteSubteamCancel")?.addEventListener("click", () => closeModal("deleteSubteamOverlay"));

    /* ═══════════════════ MANAGE MEMBERS ═══════════════════ */

    let managingSubteamId   = null;
    let managingSubteamName = null;

    async function openManageMembers(subteamId, subteamName) {
        managingSubteamId   = subteamId;
        managingSubteamName = subteamName;

        document.getElementById("manageMembersTitle").textContent   = subteamName;
        document.getElementById("manageMembersSubtitle").textContent = "Manage team members within this project.";
        document.getElementById("addMemberPanel").style.display = "none";

        await refreshMembersList();
        openModal("manageMembersOverlay");
    }

    async function refreshMembersList() {
        const res = await apiCall(
            `/api/v1/settings/teams/${currentTeamId}/subteams/${managingSubteamId}/members`,
            "GET"
        );
        if (!res) return;
        renderMembersList(res.members || []);
        renderAddMemberOptions(res.available || []);
    }

    const roleAccessMap = {
        owner:  "Full Access",
        admin:  "Full Access",
        editor: "Edit Content",
        member: "Edit Content",
        viewer: "View Only",
    };

    function renderMembersList(members) {
        const list = document.getElementById("manageMembersList");
        if (!list) return;
        list.innerHTML = "";

        if (members.length === 0) {
            list.innerHTML = `<div class="stg-members-empty">No members in this team yet.</div>`;
            return;
        }

        members.forEach(m => {
            const initials = m.initials || (m.full_name || "U").split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
            const currentRole = m.role || "member";
            const access = roleAccessMap[currentRole] || "Edit Content";

            const row = document.createElement("div");
            row.className = "stg-members-table__row";
            row.innerHTML = `
                <div class="stg-member__user">
                    <div class="stg-member__avatar" style="background:#e0e7ff;color:#4f46e5;">${escapeHtml(initials)}</div>
                    <div>
                        <div class="stg-member__name">${escapeHtml(m.full_name)}</div>
                        <div class="stg-member__email">${escapeHtml(m.email)}</div>
                    </div>
                </div>
                <div class="stg-member__role-cell">
                    <select class="stg-member__role-select" data-uid="${m.id}">
                        <option value="admin"  ${currentRole === "admin"  ? "selected" : ""}>Admin</option>
                        <option value="editor" ${currentRole === "editor" ? "selected" : ""}>Member</option>
                        <option value="viewer" ${currentRole === "viewer" ? "selected" : ""}>Viewer</option>
                    </select>
                </div>
                <div class="stg-member__access">${escapeHtml(access)}</div>
                <div class="stg-member__actions">
                    <button class="stg-member__remove" data-uid="${m.id}" title="Remove from team">
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
                    </button>
                </div>
            `;

            // Role change
            row.querySelector(".stg-member__role-select").addEventListener("change", async (e) => {
                const roleMap = { admin: "admin", editor: "editor", viewer: "viewer" };
                const roleName = roleMap[e.target.value] || "viewer";
                const result = await apiCall(
                    `/api/v1/settings/teams/${currentTeamId}/roles/${m.id}`,
                    "PUT",
                    { role_name: roleName }
                );
                if (result) {
                    showToast("Role updated", "success");
                    await refreshMembersList();
                }
            });

            // Remove from subteam
            row.querySelector(".stg-member__remove").addEventListener("click", async () => {
                const result = await apiCall(
                    `/api/v1/settings/teams/${currentTeamId}/subteams/${managingSubteamId}/members/${m.id}`,
                    "DELETE"
                );
                if (result) {
                    showToast("Member removed", "success");
                    await refreshMembersList();
                    await loadSubteams();
                }
            });

            list.appendChild(row);
        });
    }

    function renderAddMemberOptions(available) {
        const sel = document.getElementById("addMemberSelect");
        if (!sel) return;
        sel.innerHTML = `<option value="">Select a project member…</option>`;
        available.forEach(u => {
            const opt = document.createElement("option");
            opt.value = u.id;
            opt.textContent = `${u.full_name} (${u.email})`;
            sel.appendChild(opt);
        });
    }

    document.getElementById("addMemberToTeamBtn")?.addEventListener("click", () => {
        const panel = document.getElementById("addMemberPanel");
        if (panel) panel.style.display = panel.style.display === "none" ? "flex" : "none";
    });

    document.getElementById("addMemberConfirmBtn")?.addEventListener("click", async () => {
        const sel = document.getElementById("addMemberSelect");
        const userId = parseInt(sel?.value);
        if (!userId) { showToast("Please select a member", "error"); return; }
        const result = await apiCall(
            `/api/v1/settings/teams/${currentTeamId}/subteams/${managingSubteamId}/members`,
            "POST",
            { user_id: userId }
        );
        if (result) {
            showToast("Member added", "success");
            document.getElementById("addMemberPanel").style.display = "none";
            await refreshMembersList();
            await loadSubteams();
        }
    });

    document.getElementById("manageMembersClose")?.addEventListener("click", () => closeModal("manageMembersOverlay"));
    document.getElementById("manageMembersDone")?.addEventListener("click", () => closeModal("manageMembersOverlay"));

    /* ═══════════════════ INTEGRATIONS ═══════════════════ */

    async function loadIntegrationCounts() {
        if (!currentTeamId) return;
        try {
            const res = await window.__lp.authFetch(`/api/v1/rag/documents/${currentTeamId}`);
            if (!res.ok) return;
            const data = await res.json();
            const docs = data.documents || [];

            const driveCount  = docs.filter(d => {
                if (d.doc_type === "folder") return true;
                return d.source_url && d.source_url.includes("drive.google.com");
            }).length;
            const githubCount = docs.filter(d =>
                d.source_url && (d.source_url.includes("github.com") || d.source_url.includes("raw.githubusercontent.com"))
            ).length;

            const driveEl  = document.getElementById("intDriveCount");
            const githubEl = document.getElementById("intGithubCount");
            if (driveEl)  driveEl.textContent  = driveCount;
            if (githubEl) githubEl.textContent = githubCount;
        } catch { /* silently ignore */ }
    }

    // Load counts when integrations tab is activated
    document.querySelector('.stg-nav__link[data-target="integrations"]')?.addEventListener("click", () => {
        loadIntegrationCounts();
    });

    // Drive import button
    document.getElementById("intDriveImportBtn")?.addEventListener("click", () => {
        document.getElementById("stgDriveUrl").value  = "";
        document.getElementById("stgDriveName").value = "";
        document.getElementById("stgDriveStatus").textContent = "";
        document.getElementById("stgDriveStatus").className = "stg-modal__status";
        openModal("stgDriveModal");
    });
    document.getElementById("stgDriveClose")?.addEventListener("click",   () => closeModal("stgDriveModal"));
    document.getElementById("stgDriveCancelBtn")?.addEventListener("click", () => closeModal("stgDriveModal"));

    document.getElementById("stgDriveImportBtn")?.addEventListener("click", async () => {
        const url  = document.getElementById("stgDriveUrl").value.trim();
        const name = document.getElementById("stgDriveName").value.trim() || null;
        const refreshVal = document.getElementById("stgDriveRefresh").value;
        const statusEl = document.getElementById("stgDriveStatus");
        const btn = document.getElementById("stgDriveImportBtn");

        if (!url) { showToast("Please enter a Google Drive URL", "error"); return; }
        if (!currentTeamId) { showToast("No project selected", "error"); return; }

        statusEl.textContent = "Importing…";
        statusEl.className = "stg-modal__status stg-modal__status--loading";
        btn.disabled = true;

        const body = { team_id: currentTeamId, drive_url: url, custom_name: name };
        if (refreshVal) body.refresh_interval_hours = parseInt(refreshVal);

        const opts = {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        };
        try {
            const res = await window.__lp.authFetch("/api/v1/rag/ingest-drive", opts);
            if (res.ok) {
                closeModal("stgDriveModal");
                showToast("Drive import queued — processing in background", "success");
                loadIntegrationCounts();
            } else {
                const err = await res.json().catch(() => ({}));
                statusEl.textContent = err.detail || "Import failed";
                statusEl.className = "stg-modal__status stg-modal__status--error";
                btn.disabled = false;
            }
        } catch {
            statusEl.textContent = "Network error";
            statusEl.className = "stg-modal__status stg-modal__status--error";
            btn.disabled = false;
        }
    });

    // GitHub import button
    document.getElementById("intGithubImportBtn")?.addEventListener("click", () => {
        document.getElementById("stgGithubUrl").value  = "";
        document.getElementById("stgGithubName").value = "";
        document.getElementById("stgGithubStatus").textContent = "";
        document.getElementById("stgGithubStatus").className = "stg-modal__status";
        openModal("stgGithubModal");
    });
    document.getElementById("stgGithubClose")?.addEventListener("click",    () => closeModal("stgGithubModal"));
    document.getElementById("stgGithubCancelBtn")?.addEventListener("click", () => closeModal("stgGithubModal"));

    document.getElementById("stgGithubImportBtn")?.addEventListener("click", async () => {
        const url  = document.getElementById("stgGithubUrl").value.trim();
        const name = document.getElementById("stgGithubName").value.trim() || null;
        const statusEl = document.getElementById("stgGithubStatus");
        const btn = document.getElementById("stgGithubImportBtn");

        if (!url) { showToast("Please enter a GitHub URL", "error"); return; }
        if (!url.startsWith("http")) {
            statusEl.textContent = "GitHub URL must start with http:// or https://";
            statusEl.className = "stg-modal__status stg-modal__status--error";
            return;
        }
        if (!currentTeamId) { showToast("No project selected", "error"); return; }

        statusEl.textContent = "Importing…";
        statusEl.className = "stg-modal__status stg-modal__status--loading";
        btn.disabled = true;

        const opts = {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ team_id: currentTeamId, github_url: url, custom_name: name }),
        };
        try {
            const res = await window.__lp.authFetch("/api/v1/rag/ingest-github", opts);
            if (res.ok) {
                closeModal("stgGithubModal");
                showToast("GitHub file imported successfully", "success");
                loadIntegrationCounts();
            } else {
                const err = await res.json().catch(() => ({}));
                statusEl.textContent = err.detail || "Import failed";
                statusEl.className = "stg-modal__status stg-modal__status--error";
                btn.disabled = false;
            }
        } catch {
            statusEl.textContent = "Network error";
            statusEl.className = "stg-modal__status stg-modal__status--error";
            btn.disabled = false;
        }
    });

    /* ═══════════════════ SECURITY ═══════════════════ */

    const changePasswordBtn = document.getElementById("changePasswordBtn");
    if (changePasswordBtn) {
        changePasswordBtn.addEventListener("click", () => {
            showToast("Password change coming soon", "success");
        });
    }

    /* ═══════════════════ DANGER ZONE ═══════════════════ */

    document.getElementById("archiveProjectBtn")?.addEventListener("click", () => {
        showToast("Archive feature coming soon", "success");
    });

    document.getElementById("deleteProjectBtn")?.addEventListener("click", () => {
        if (confirm("Are you sure you want to permanently delete this project? This action cannot be undone.")) {
            showToast("Delete feature coming soon", "success");
        }
    });

    /* ═══════════════════ INVITE (legacy compat) ═══════════════════ */

    const inviteModalOverlay = document.getElementById("inviteModalOverlay");
    const inviteForm = document.getElementById("inviteForm");

    document.getElementById("inviteCancel")?.addEventListener("click", () => closeModal("inviteModalOverlay"));
    document.getElementById("inviteCancelBtn")?.addEventListener("click", () => closeModal("inviteModalOverlay"));

    if (inviteForm) {
        inviteForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            const payload = {
                email: document.getElementById("inviteEmail").value,
                role: document.getElementById("inviteRole").value
            };
            const res = await apiCall(`/api/v1/settings/teams/${currentTeamId}/invites`, "POST", payload);
            if (res) {
                showToast("Invite sent!", "success");
                closeModal("inviteModalOverlay");
                inviteForm.reset();
            }
        });
    }

    /* ═══════════════════ UTILITIES ═══════════════════ */

    function openModal(id) {
        const el = document.getElementById(id);
        if (!el) return;
        el.style.display = "flex";
        el.classList.add("active");
    }

    function closeModal(id) {
        const el = document.getElementById(id);
        if (!el) return;
        el.style.display = "none";
        el.classList.remove("active");
    }

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
            if (r.status === 204) return {};
            return await r.json();
        } catch {
            showToast("Network error", "error");
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

    function escapeHtml(str) {
        if (!str) return "";
        const d = document.createElement("div");
        d.textContent = str;
        return d.innerHTML;
    }
});
