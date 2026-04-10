document.addEventListener("DOMContentLoaded", () => {

    /* ── Element refs ── */
    const navLinks     = document.querySelectorAll(".stg-nav__link");
    const sections     = document.querySelectorAll(".stg-section");

    const projectForm       = document.getElementById("projectForm");
    const sensitivitySlider = document.getElementById("sensitivitySlider");
    const sensitivityValue  = document.getElementById("sensitivityValue");

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

            // AI Sensitivity
            if (sensitivitySlider && activeTeam.ai_sensitivity !== undefined) {
                sensitivitySlider.value = activeTeam.ai_sensitivity;
                if (sensitivityValue) sensitivityValue.textContent = activeTeam.ai_sensitivity + "%";
            }

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

    /* ═══════════════════ AI SENSITIVITY ═══════════════════ */

    if (sensitivitySlider) {
        sensitivitySlider.addEventListener("input", (e) => {
            if (sensitivityValue) sensitivityValue.textContent = e.target.value + "%";
        });
        sensitivitySlider.addEventListener("change", async (e) => {
            if (!currentTeamId) return;
            await apiCall(`/api/v1/settings/teams/${currentTeamId}`, "PUT", { ai_sensitivity: parseInt(e.target.value) });
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
                showToast("Member management for teams coming soon", "success");
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
