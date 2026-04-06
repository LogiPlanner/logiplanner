document.addEventListener("DOMContentLoaded", () => {
    
    // Elements
    const navItems = document.querySelectorAll(".settings-nav__item");
    const panels = document.querySelectorAll(".settings-panel");
    const restrictedOverlay = document.getElementById("restrictedOverlay");
    
    const profileForm = document.getElementById("profileForm");
    const projectForm = document.getElementById("projectForm");
    
    const teamMembersList = document.getElementById("teamMembersList");
    const permissionsList = document.getElementById("permissionsList");
    
    // New Elements
    const toggleEmail = document.getElementById("toggleEmail");
    const toggleDashboard = document.getElementById("toggleDashboard");
    const toggleDeadline = document.getElementById("toggleDeadline");
    const sensitivitySlider = document.getElementById("sensitivitySlider");
    const sensitivityFill = document.getElementById("sensitivityFill");
    const sensitivityValue = document.getElementById("sensitivityValue");
    const workspaceRole = document.getElementById("workspaceRole");
    
    const inviteModalOverlay = document.getElementById("inviteModalOverlay");
    const openInviteModalBtn = document.getElementById("openInviteModal");
    const inviteCancelBtn = document.getElementById("inviteCancel");
    const inviteForm = document.getElementById("inviteForm");
    
    const removeModalOverlay = document.getElementById("removeModalOverlay");
    const removeCancelBtn = document.getElementById("removeCancel");
    const removeConfirmBtn = document.getElementById("removeConfirmBtn");
    
    const copyInviteCodeBtn = document.getElementById("copySettingsInviteCode");
    const inviteCodeDisplay = document.getElementById("projectSettingsInviteCode");

    // State
    let userRole = "viewer"; // Default to lowest
    let currentTeamId = null;
    let currentUserData = null;
    let currentInviteCode = null;

    // ----- INITIALIZATION -----
    
    async function init() {
        // First check profile status to get user info and team
        try {
            const token = localStorage.getItem("access_token");
            if (!token) {
                window.location.href = "/login";
                return;
            }
            
            // 1. Get profile status (which gives us user info)
            const profileRes = await fetch("/api/v1/profile-status", {
                headers: { "Authorization": `Bearer ${token}` }
            });
            if (profileRes.status !== 200) throw new Error("Not authenticated");
            const profileData = await profileRes.json();
            currentUserData = profileData;
            
            // Populate profile form
            document.getElementById("profileName").value = profileData.full_name || '';
            document.getElementById("profileEmail").value = profileData.email || '';
            
            if(toggleEmail) toggleEmail.classList.toggle("active", profileData.notify_email);
            if(toggleDashboard) toggleDashboard.classList.toggle("active", profileData.notify_dashboard);
            if(toggleDeadline) toggleDeadline.classList.toggle("active", profileData.notify_deadline);
            
            if (!profileData.has_teams) {
                // If no team, restrict team/project tabs heavily
                userRole = "viewer";
                return;
            }
            
            // 2. We need the active team to populate Team and Project tables.
            // Check Sidebar's teamSelect or get first team from /my-teams
            // Note: correct endpoint is /onboarding/my-teams
            const myTeamsRes = await fetch("/api/v1/onboarding/my-teams", {
                headers: { "Authorization": `Bearer ${token}` }
            });
            if (myTeamsRes.status === 200) {
                const teamsData = await myTeamsRes.json();
                if (teamsData.teams.length > 0) {
                    // parseInt: localStorage returns strings, team IDs are integers
                    const storedId = parseInt(localStorage.getItem("selected_team_id"));
                    const matchedTeam = teamsData.teams.find(t => t.id === storedId);
                    const activeTeam = matchedTeam || teamsData.teams[0];
                    
                    currentTeamId = activeTeam.id;
                    localStorage.setItem("selected_team_id", currentTeamId);
                    userRole = activeTeam.role; // "owner", "editor", or "viewer"
                    currentInviteCode = activeTeam.invite_code;
                    
                    console.log(`[Settings] Project: ${activeTeam.team_name} | Role: ${userRole}`);
                    
                    document.getElementById("projectName").value = activeTeam.team_name;
                    document.getElementById("projectDesc").value = activeTeam.description || "";
                    
                    if (workspaceRole) workspaceRole.value = userRole;
                    
                    if(sensitivitySlider && activeTeam.ai_sensitivity !== undefined) {
                        sensitivitySlider.value = activeTeam.ai_sensitivity;
                        if(sensitivityFill) sensitivityFill.style.width = activeTeam.ai_sensitivity + "%";
                        if(sensitivityValue) sensitivityValue.innerText = activeTeam.ai_sensitivity + "%";
                    }
                    
                    if (inviteCodeDisplay && currentInviteCode) {
                        inviteCodeDisplay.innerText = currentInviteCode;
                    }
                    
                    // Load team members
                    await loadTeamMembers();
                }
            }
            
            // Auto-select tab if in URL
            const urlParams = new URLSearchParams(window.location.search);
            const tabUrl = urlParams.get('tab');
            if (tabUrl) {
                const targetBtn = document.querySelector(`.settings-nav__item[data-target="${tabUrl}"]`);
                if (targetBtn) targetBtn.click();
            }
            
        } catch (e) {
            console.error(e);
            window.location.href = "/login";
        }
    }
    
    init();

    // ----- NAVIGATION -----
    
    navItems.forEach(item => {
        item.addEventListener("click", (event) => {
            event.preventDefault();
            const target = item.getAttribute("data-target");
            
            // Deactivate all
            navItems.forEach(n => n.classList.remove("active"));
            panels.forEach(p => p.classList.remove("active"));
            
            // Activate target
            item.classList.add("active");
            document.getElementById(`panel-${target}`).classList.add("active");
            
            // Check Permissions (Only owners can see Team/Permissions/Project)
            if (restrictedOverlay) {
                restrictedOverlay.classList.toggle("active", target !== 'profile' && userRole !== 'owner');
            }
        });
    });

    // ----- PROFILE MANAGEMENT -----
    
    profileForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const payload = {
            full_name: document.getElementById("profileName").value,
            email: document.getElementById("profileEmail").value
        };
        const success = await apiCall("/api/v1/settings/profile", "PUT", payload);
        if (success) {
            showToast("Profile updated successfully", "success");
            // If sidebar username element exists, update it
            const sbName = document.getElementById("sidebarUserName");
            if (sbName) sbName.textContent = payload.full_name;
        }
    });

    // Auto-save logic for toggles and sliders
    function attachToggleLogic(el, fieldName) {
        if (!el) return;
        el.addEventListener("click", async () => {
            const isActive = el.classList.contains("active");
            const newValue = !isActive;
            el.classList.toggle("active");
            
            const payload = {};
            payload[fieldName] = newValue;
            await apiCall("/api/v1/settings/profile", "PUT", payload);
        });
    }
    
    attachToggleLogic(toggleEmail, "notify_email");
    attachToggleLogic(toggleDashboard, "notify_dashboard");
    attachToggleLogic(toggleDeadline, "notify_deadline");

    if (sensitivitySlider) {
        sensitivitySlider.addEventListener("input", (e) => {
            const val = e.target.value;
            if(sensitivityFill) sensitivityFill.style.width = val + "%";
            if(sensitivityValue) sensitivityValue.innerText = val + "%";
        });
        sensitivitySlider.addEventListener("change", async (e) => {
            if(!currentTeamId) return;
            const val = parseInt(e.target.value);
            const res = await apiCall(`/api/v1/settings/teams/${currentTeamId}`, "PUT", { ai_sensitivity: val });
            if(res) {
                showToast("AI Sensitivity updated", "success");
            }
        });
    }

    // ----- PROJECT SETTINGS -----
    
    projectForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!currentTeamId) return;
        
        const payload = {
            team_name: document.getElementById("projectName").value,
            description: document.getElementById("projectDesc").value
        };
        const res = await apiCall(`/api/v1/settings/teams/${currentTeamId}`, "PUT", payload);
        if (res) {
            showToast("Project settings updated", "success");
            
            // To prevent duplicate options logic issues with common.js, let's just force a clean page reload
            // This is safer and guarantees the sidebar and dashboard catch the new project name everywhere
            setTimeout(() => {
                window.location.reload();
            }, 500);
        }
    });

    // ----- TEAM MANAGEMENT & PERMISSIONS -----
    
    async function loadTeamMembers() {
        if (!currentTeamId) return;
        const res = await apiCall(`/api/v1/settings/teams/${currentTeamId}/members`, "GET");
        if (res && res.members) {
            renderTeamList(res.members);
            renderPermissionsList(res.members);
        }
    }
    
    function renderTeamList(members) {
        teamMembersList.innerHTML = "";
        members.forEach(member => {
            const isSelf = member.email === currentUserData?.email;
            const div = document.createElement("div");
            div.className = "team-item";
            
            // Randomly select one of the user snippet avatar colors
            const avatarColors = [
                { bg: 'bg-indigo-100', text: 'text-indigo-600', color: '#4f46e5', bkg: '#e0e7ff' },
                { bg: 'bg-orange-100', text: 'text-orange-600', color: '#ea580c', bkg: '#ffedd5' },
                { bg: 'bg-slate-100', text: 'text-slate-600', color: '#475569', bkg: '#f1f5f9' }
            ];
            const c = avatarColors[member.id % avatarColors.length];

            div.innerHTML = `
                <div style="display:flex; align-items:center; gap:16px;">
                    <div class="team-avatar" style="background:${c.bkg}; color:${c.color};">
                        ${member.avatar.includes('img') ? member.avatar : `<span style="font-size:14px;">${member.avatar}</span>`}
                    </div>
                    <div class="team-info">
                        <h4>${member.full_name} ${isSelf ? '(You)' : ''}</h4>
                        <p>${member.email}</p>
                    </div>
                </div>
                <div style="display:flex; align-items:center; gap:16px;">
                    <select class="form-input" style="padding: 6px 32px 6px 12px; font-size:0.75rem; font-weight:600; border-radius:0.5rem; background:var(--sys-surface-low);" disabled>
                        <option>${capitalizeRole(member.role)}</option>
                    </select>
                    <button class="settings-btn-icon" data-id="${member.id}" data-name="${member.full_name}" title="Remove Member" style="background:none; border:none; color:var(--sys-outline); cursor:pointer; padding:4px;" ${isSelf ? 'disabled' : ''}>
                        <span class="material-symbols-outlined" style="font-size:20px;">delete</span>
                    </button>
                </div>
            `;
            teamMembersList.appendChild(div);
        });
        
        // Attach remove events
        teamMembersList.querySelectorAll(".settings-btn-icon").forEach(btn => {
            btn.addEventListener("click", () => {
                document.getElementById("removeMemberId").value = btn.getAttribute("data-id");
                document.getElementById("removeMemberName").textContent = btn.getAttribute("data-name");
                removeModalOverlay.classList.add("active");
            });
        });
    }
    
    function renderPermissionsList(members) {
        permissionsList.innerHTML = "";
        members.forEach(member => {
            const isSelf = member.email === currentUserData?.email;
            
            const div = document.createElement("div");
            div.className = "team-item";
            
            const avatarColors = [
                { bg: 'bg-indigo-100', text: 'text-indigo-600', color: '#4f46e5', bkg: '#e0e7ff' },
                { bg: 'bg-orange-100', text: 'text-orange-600', color: '#ea580c', bkg: '#ffedd5' },
                { bg: 'bg-slate-100', text: 'text-slate-600', color: '#475569', bkg: '#f1f5f9' }
            ];
            const c = avatarColors[member.id % avatarColors.length];

            div.innerHTML = `
                <div style="display:flex; align-items:center; gap:16px;">
                    <div class="team-avatar" style="background:${c.bkg}; color:${c.color};">
                        ${member.avatar.includes('img') ? member.avatar : `<span style="font-size:14px;">${member.avatar}</span>`}
                    </div>
                    <div class="team-info">
                        <h4>${member.full_name} ${isSelf ? '(You)' : ''}</h4>
                        <p>${member.email}</p>
                    </div>
                </div>
                <div style="display:flex; align-items:center; gap:16px;">
                    <select class="settings-select form-input" style="padding: 6px 32px 6px 12px; font-size:0.75rem; font-weight:600; border-radius:0.5rem; background:var(--sys-surface-low);" data-id="${member.id}" ${isSelf ? 'disabled' : ''}>
                        <option value="owner" ${member.role === 'owner' ? 'selected' : ''}>Owner</option>
                        <option value="editor" ${member.role === 'editor' ? 'selected' : ''}>Editor</option>
                        <option value="viewer" ${member.role === 'viewer' ? 'selected' : ''}>Viewer</option>
                    </select>
                </div>
            `;
            permissionsList.appendChild(div);
        });
        
        // Attach change role events
        permissionsList.querySelectorAll(".settings-select").forEach(sel => {
            sel.addEventListener("change", async (e) => {
                const userId = sel.getAttribute("data-id");
                const newRole = e.target.value;
                const res = await apiCall(`/api/v1/settings/teams/${currentTeamId}/roles/${userId}`, "PUT", { role_name: newRole });
                if (res) {
                    showToast(`Role updated to ${capitalizeRole(newRole)}`, "success");
                    loadTeamMembers(); // Refresh UI to sync Project Settings tab
                } else {
                    // Revert UI on failure
                    loadTeamMembers(); 
                }
            });
        });
    }

    // ----- MODALS & UTILS -----
    
    if (copyInviteCodeBtn && inviteCodeDisplay) {
        copyInviteCodeBtn.addEventListener("click", () => {
            const code = inviteCodeDisplay.innerText;
            if (code && code !== "--------") {
                navigator.clipboard.writeText(code).then(() => {
                    showToast("Invite code copied to clipboard", "success");
                });
            }
        });
    }

    openInviteModalBtn.addEventListener("click", () => inviteModalOverlay.classList.add("active"));
    inviteCancelBtn.addEventListener("click", () => inviteModalOverlay.classList.remove("active"));
    
    inviteForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const payload = {
            email: document.getElementById("inviteEmail").value,
            role: document.getElementById("inviteRole").value
        };
        
        const res = await apiCall(`/api/v1/settings/teams/${currentTeamId}/invites`, "POST", payload);
        if (res) {
            showToast("Invite Sent!", "success");
            inviteModalOverlay.classList.remove("active");
            inviteForm.reset();
            loadTeamMembers();
        }
    });
    
    removeCancelBtn.addEventListener("click", () => removeModalOverlay.classList.remove("active"));
    
    removeConfirmBtn.addEventListener("click", async () => {
        const userId = document.getElementById("removeMemberId").value;
        const res = await apiCall(`/api/v1/settings/teams/${currentTeamId}/members/${userId}`, "DELETE");
        if (res) {
            showToast("Member removed", "success");
            removeModalOverlay.classList.remove("active");
            loadTeamMembers();
        }
    });


    // ----- UTILITIES -----
    
    async function apiCall(endpoint, method, bodyObj = null) {
        const token = localStorage.getItem("access_token");
        const options = {
            method: method,
            headers: {
                "Authorization": `Bearer ${token}`
            }
        };
        if (bodyObj) {
            options.headers["Content-Type"] = "application/json";
            options.body = JSON.stringify(bodyObj);
        }
        
        try {
            const response = await fetch(endpoint, options);
            if (!response.ok) {
                const errData = await response.json();
                showToast(errData.detail || "An error occurred", "error");
                return null;
            }
            return await response.json();
        } catch (e) {
            showToast("Network Error: Could not reach server", "error");
            return null;
        }
    }

    function showToast(message, type = "success") {
        // Simple toast implementation mapped to UI
        const toast = document.createElement("div");
        toast.style.position = "fixed";
        toast.style.bottom = "24px";
        toast.style.right = "24px";
        toast.style.padding = "12px 24px";
        toast.style.borderRadius = "8px";
        toast.style.color = "white";
        toast.style.fontWeight = "500";
        toast.style.zIndex = "9999";
        toast.style.boxShadow = "0 10px 15px -3px rgba(0,0,0,0.5)";
        toast.style.animation = "fadeIn 0.3s ease";
        
        if (type === "success") {
            toast.style.background = "#06d6a0"; // primary teal
        } else {
            toast.style.background = "#ef4444"; // red
        }
        
        toast.innerText = message;
        document.body.appendChild(toast);
        
        setTimeout(() => {
            toast.style.opacity = "0";
            toast.style.transition = "opacity 0.3s";
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }
    
    function capitalizeRole(str) {
        if (!str) return '';
        return str.charAt(0).toUpperCase() + str.slice(1);
    }
});
