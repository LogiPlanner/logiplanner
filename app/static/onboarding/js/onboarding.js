/* ═══════════════════════════════════════════════════════════════
   LogiPlanner — Onboarding Wizard Logic
   Multi-step flow for Create Team / Join Team
   ═══════════════════════════════════════════════════════════════ */

// State
let currentFlow = null;          // 'create' | 'join'
let createdTeamData = null;      // { team_id, team_name, invite_code }
let selectedFiles = [];          // Files queued for upload
let joinInviteCode = '';         // Stored invite code for join flow

const CREATE_STEPS = [
    { id: 'step-create-1', label: 'Team Info' },
    { id: 'step-create-2', label: 'Your Details' },
    { id: 'step-create-3', label: 'Add Data' },
    { id: 'step-create-4', label: 'Invite Team' },
];

const JOIN_STEPS = [
    { id: 'step-join-1', label: 'Find Team' },
    { id: 'step-join-2', label: 'Your Details' },
    { id: 'step-join-3', label: 'Project Brief' },
];


// ──────────────────────────────────────────────
// NAVIGATION
// ──────────────────────────────────────────────

function showStep(stepId) {
    document.querySelectorAll('.wizard-step').forEach(s => s.classList.remove('active'));
    const target = document.getElementById(stepId);
    if (target) target.classList.add('active');
    updateProgress(stepId);
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function goBack(stepId) {
    showStep(stepId);
}

function skipStep(stepId) {
    showStep(stepId);
}

function startFlow(flow) {
    currentFlow = flow;
    if (flow === 'create') {
        showStep('step-create-1');
    } else {
        showStep('step-join-1');
    }
}

function updateProgress(activeStepId) {
    const container = document.getElementById('progressSteps');
    const steps = currentFlow === 'create' ? CREATE_STEPS : currentFlow === 'join' ? JOIN_STEPS : [];

    if (!steps.length) {
        container.innerHTML = '';
        return;
    }

    const activeIndex = steps.findIndex(s => s.id === activeStepId);

    container.innerHTML = steps.map((step, i) => {
        let cls = 'progress-step';
        if (i < activeIndex) cls += ' done';
        else if (i === activeIndex) cls += ' active';

        const dotContent = i < activeIndex ? '✓' : (i + 1);

        return `
            <div class="${cls}">
                <div class="progress-step__dot">${dotContent}</div>
                <div class="progress-step__text">${step.label}</div>
            </div>
        `;
    }).join('');
}

function finishOnboarding() {
    window.location.href = '/dashboard';
}


// ──────────────────────────────────────────────
// AUTH HELPERS
// ──────────────────────────────────────────────

function getToken() {
    return localStorage.getItem('access_token');
}

async function authPost(url, payload) {
    const token = getToken();
    if (!token) {
        window.location.href = '/login';
        return null;
    }
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + token,
        },
        body: JSON.stringify(payload),
    });
    let data = {};
    try { data = await res.json(); } catch (e) {}
    return { response: res, data };
}

async function authGet(url) {
    const token = getToken();
    if (!token) {
        window.location.href = '/login';
        return null;
    }
    const res = await fetch(url, {
        headers: { 'Authorization': 'Bearer ' + token },
    });
    let data = {};
    try { data = await res.json(); } catch (e) {}
    return { response: res, data };
}


// ──────────────────────────────────────────────
// CREATE FLOW — Step 1: Team Name
// ──────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    window.AuthUI.storeTokenFromUrl();

    const token = getToken();
    if (!token) { window.location.href = '/login'; return; }

    // Step 1 form
    const step1Form = document.getElementById('createStep1Form');
    if (step1Form) {
        step1Form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const msg = document.getElementById('createStep1Msg');
            const btn = document.getElementById('createStep1Btn');
            const teamName = document.getElementById('c_teamName').value.trim();
            const teamDesc = document.getElementById('c_teamDesc').value.trim();

            if (!teamName) {
                window.AuthUI.setMessage(msg, 'error', 'Team name is required.');
                return;
            }

            // If team was already created in this session, skip the API and advance
            if (createdTeamData) {
                showStep('step-create-2');
                return;
            }

            window.AuthUI.setMessage(msg, '', '');
            window.AuthUI.setButtonLoading(btn, true, 'Continue', 'Creating team...');

            try {
                const result = await authPost('/api/v1/onboarding/create-team-full', {
                    team_name: teamName,
                    description: teamDesc || null,
                });

                if (!result) return;

                if (result.response.ok) {
                    createdTeamData = result.data;
                    showStep('step-create-2');
                } else {
                    window.AuthUI.setMessage(msg, 'error', result.data.detail || 'Could not create team.');
                }
            } catch (err) {
                window.AuthUI.setMessage(msg, 'error', 'Network error. Please try again.');
            } finally {
                window.AuthUI.setButtonLoading(btn, false, 'Continue', 'Creating team...');
            }
        });
    }

    // Step 2 form
    const step2Form = document.getElementById('createStep2Form');
    if (step2Form) {
        step2Form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const msg = document.getElementById('createStep2Msg');
            const btn = document.getElementById('createStep2Btn');

            const payload = {
                full_name: document.getElementById('c_fullName').value.trim(),
                job_title: document.getElementById('c_jobTitle').value.trim(),
                project_stage: document.getElementById('c_projectStage').value || null,
                project_info: document.getElementById('c_projectInfo').value.trim() || null,
            };

            if (!payload.full_name || !payload.job_title) {
                window.AuthUI.setMessage(msg, 'error', 'Name and job title are required.');
                return;
            }

            window.AuthUI.setMessage(msg, '', '');
            window.AuthUI.setButtonLoading(btn, true, 'Continue', 'Saving...');

            try {
                const result = await authPost('/api/v1/onboarding/save-owner-details', payload);
                if (!result) return;

                if (result.response.ok) {
                    showStep('step-create-3');
                } else {
                    window.AuthUI.setMessage(msg, 'error', result.data.detail || 'Failed to save.');
                }
            } catch (err) {
                window.AuthUI.setMessage(msg, 'error', 'Network error.');
            } finally {
                window.AuthUI.setButtonLoading(btn, false, 'Continue', 'Saving...');
            }
        });
    }

    // Step 4: Show invite code
    // (populated when step-create-4 becomes active)

    // File upload zone
    setupFileUpload();

    // Join Step 1
    const joinStep1 = document.getElementById('joinStep1Form');
    if (joinStep1) {
        joinStep1.addEventListener('submit', async (e) => {
            e.preventDefault();
            const msg = document.getElementById('joinStep1Msg');
            const btn = document.getElementById('joinStep1Btn');
            const code = document.getElementById('j_inviteCode').value.trim();

            if (!code) {
                window.AuthUI.setMessage(msg, 'error', 'Please enter an invite code.');
                return;
            }

            window.AuthUI.setMessage(msg, '', '');
            window.AuthUI.setButtonLoading(btn, true, 'Find Team', 'Looking up...');

            try {
                const result = await authGet('/api/v1/onboarding/team-preview/' + encodeURIComponent(code));
                if (!result) return;

                if (result.response.ok) {
                    joinInviteCode = code;
                    document.getElementById('j_previewName').textContent = result.data.team_name;
                    document.getElementById('j_previewMeta').textContent =
                        (result.data.description || 'No description') + ' · ' +
                        result.data.member_count + ' member' + (result.data.member_count !== 1 ? 's' : '');
                    document.getElementById('j_previewOwner').textContent =
                        result.data.owner_name ? 'Created by ' + result.data.owner_name : '';
                    document.getElementById('joinPreview').style.display = 'flex';
                } else {
                    document.getElementById('joinPreview').style.display = 'none';
                    window.AuthUI.setMessage(msg, 'error', result.data.detail || 'Team not found.');
                }
            } catch (err) {
                window.AuthUI.setMessage(msg, 'error', 'Network error.');
            } finally {
                window.AuthUI.setButtonLoading(btn, false, 'Find Team', 'Looking up...');
            }
        });
    }

    // Join Step 2
    const joinStep2 = document.getElementById('joinStep2Form');
    if (joinStep2) {
        joinStep2.addEventListener('submit', async (e) => {
            e.preventDefault();
            const msg = document.getElementById('joinStep2Msg');
            const btn = document.getElementById('joinStep2Btn');

            const payload = {
                full_name: document.getElementById('j_fullName').value.trim(),
                job_title: document.getElementById('j_jobTitle').value.trim(),
                role_preference: document.getElementById('j_rolePref').value || null,
            };

            if (!payload.full_name || !payload.job_title) {
                window.AuthUI.setMessage(msg, 'error', 'Name and job title are required.');
                return;
            }

            window.AuthUI.setMessage(msg, '', '');
            window.AuthUI.setButtonLoading(btn, true, 'Join & Continue', 'Joining...');

            try {
                const result = await authPost(
                    '/api/v1/onboarding/join-team-full?invite_code=' + encodeURIComponent(joinInviteCode),
                    payload
                );
                if (!result) return;

                if (result.response.ok) {
                    // Load onboarding brief
                    await loadOnboardingBrief();
                    showStep('step-join-3');
                } else {
                    window.AuthUI.setMessage(msg, 'error', result.data.detail || 'Could not join team.');
                }
            } catch (err) {
                window.AuthUI.setMessage(msg, 'error', 'Network error.');
            } finally {
                window.AuthUI.setButtonLoading(btn, false, 'Join & Continue', 'Joining...');
            }
        });
    }
});


// ──────────────────────────────────────────────
// CREATE FLOW — Step 3: File Upload
// ──────────────────────────────────────────────

function setupFileUpload() {
    const zone = document.getElementById('uploadZone');
    const input = document.getElementById('fileInput');
    if (!zone || !input) return;

    zone.addEventListener('click', () => input.click());

    zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        zone.classList.add('drag-over');
    });

    zone.addEventListener('dragleave', () => {
        zone.classList.remove('drag-over');
    });

    zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('drag-over');
        addFiles(e.dataTransfer.files);
    });

    input.addEventListener('change', () => {
        addFiles(input.files);
        input.value = '';
    });
}

function addFiles(fileList) {
    for (const f of fileList) {
        if (f.size > 10 * 1024 * 1024) {
            alert(`"${f.name}" is too large (max 10MB).`);
            continue;
        }
        if (!selectedFiles.find(sf => sf.name === f.name && sf.size === f.size)) {
            selectedFiles.push(f);
        }
    }
    renderFileList();
}

function removeFile(index) {
    selectedFiles.splice(index, 1);
    renderFileList();
}

function renderFileList() {
    const list = document.getElementById('uploadList');
    if (!list) return;

    if (selectedFiles.length === 0) {
        list.innerHTML = '';
        return;
    }

    list.innerHTML = selectedFiles.map((f, i) => {
        const icon = getFileIcon(f.name);
        const size = formatSize(f.size);
        return `
            <div class="upload-item">
                <div class="upload-item__icon">${icon}</div>
                <div class="upload-item__name">${f.name}</div>
                <div class="upload-item__size">${size}</div>
                <button class="upload-item__remove" onclick="removeFile(${i})" title="Remove">✕</button>
            </div>
        `;
    }).join('');
}

function getFileIcon(name) {
    const ext = name.split('.').pop().toLowerCase();
    const icons = { pdf: '📑', doc: '📝', docx: '📝', txt: '📄', md: '📄', png: '🖼️', jpg: '🖼️', jpeg: '🖼️' };
    return icons[ext] || '📎';
}

function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}


// ──────────────────────────────────────────────
// CREATE FLOW — Step 3: Save Ingestion
// ──────────────────────────────────────────────

async function saveIngestion() {
    const msg = document.getElementById('createStep3Msg');
    const btn = document.getElementById('createStep3Btn');

    window.AuthUI.setMessage(msg, '', '');
    window.AuthUI.setButtonLoading(btn, true, 'Continue', 'Saving...');

    try {
        // Upload files if any
        if (selectedFiles.length > 0) {
            const formData = new FormData();
            selectedFiles.forEach(f => formData.append('files', f));

            const token = getToken();
            const uploadRes = await fetch('/api/v1/onboarding/upload-documents', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + token },
                body: formData,
            });

            if (!uploadRes.ok) {
                const err = await uploadRes.json().catch(() => ({}));
                window.AuthUI.setMessage(msg, 'error', err.detail || 'File upload failed.');
                return;
            }
        }

        // Save links
        const links = collectLinks();
        const notes = document.getElementById('c_notes').value.trim();

        if (links.length > 0 || notes) {
            const result = await authPost('/api/v1/onboarding/save-ingestion-links', { links, notes: notes || null });
            if (!result || !result.response.ok) {
                const detail = result?.data?.detail || 'Failed to save links.';
                window.AuthUI.setMessage(msg, 'error', detail);
                return;
            }
        }

        // Show invite code on step 4
        if (createdTeamData) {
            document.getElementById('inviteCodeDisplay').textContent = createdTeamData.invite_code;
            document.getElementById('inviteCodeCard').style.display = 'block';
        }

        showStep('step-create-4');
    } catch (err) {
        window.AuthUI.setMessage(msg, 'error', 'Network error.');
    } finally {
        window.AuthUI.setButtonLoading(btn, false, 'Continue', 'Saving...');
    }
}

function collectLinks() {
    const rows = document.querySelectorAll('#linksList .link-row');
    const links = [];
    rows.forEach(row => {
        const url = row.querySelector('.link-url').value.trim();
        if (url) {
            links.push({
                url,
                source_type: row.querySelector('.link-type').value,
                label: row.querySelector('.link-label').value.trim() || null,
            });
        }
    });
    return links;
}


// ──────────────────────────────────────────────
// CREATE FLOW — Step 4: Invites
// ──────────────────────────────────────────────

function addInviteRow() {
    const container = document.getElementById('inviteRows');
    const idx = container.children.length;
    const row = document.createElement('div');
    row.className = 'invite-row';
    row.dataset.index = idx;
    row.innerHTML = `
        <input type="email" class="form-input invite-email" placeholder="colleague@company.com">
        <select class="form-select invite-role" style="width:130px;">
            <option value="member">Member</option>
            <option value="admin">Admin</option>
        </select>
    `;
    container.appendChild(row);
}

async function sendInvitesAndFinish() {
    const msg = document.getElementById('createStep4Msg');
    const btn = document.getElementById('createStep4Btn');

    const rows = document.querySelectorAll('#inviteRows .invite-row');
    const invites = [];
    rows.forEach(row => {
        const email = row.querySelector('.invite-email').value.trim();
        if (email) {
            invites.push({
                email,
                role: row.querySelector('.invite-role').value,
            });
        }
    });

    if (invites.length === 0) {
        finishOnboarding();
        return;
    }

    window.AuthUI.setMessage(msg, '', '');
    window.AuthUI.setButtonLoading(btn, true, 'Send Invites & Finish 🎉', 'Sending...');

    try {
        const result = await authPost('/api/v1/onboarding/send-invites', { invites });
        if (!result) return;

        if (result.response.ok) {
            window.AuthUI.setMessage(msg, 'success', `Invited ${invites.length} member(s)! Redirecting...`);
            setTimeout(finishOnboarding, 1200);
        } else {
            window.AuthUI.setMessage(msg, 'error', result.data.detail || 'Failed to send invites.');
        }
    } catch (err) {
        window.AuthUI.setMessage(msg, 'error', 'Network error.');
    } finally {
        window.AuthUI.setButtonLoading(btn, false, 'Send Invites & Finish 🎉', 'Sending...');
    }
}

function copyInviteCode() {
    const code = document.getElementById('inviteCodeDisplay').textContent;
    navigator.clipboard.writeText(code).then(() => {
        const btn = event.target;
        const original = btn.textContent;
        btn.textContent = '✅ Copied!';
        setTimeout(() => { btn.textContent = original; }, 2000);
    });
}


// ──────────────────────────────────────────────
// LINK ROWS
// ──────────────────────────────────────────────

function addLinkRow() {
    const container = document.getElementById('linksList');
    const idx = container.children.length;
    const row = document.createElement('div');
    row.className = 'link-row';
    row.dataset.index = idx;
    row.innerHTML = `
        <select class="form-select link-type" style="width:140px;">
            <option value="link">🔗 Link</option>
            <option value="google_drive">📁 Google Drive</option>
            <option value="miro">🎨 Miro</option>
            <option value="github">💻 GitHub</option>
            <option value="notion">📝 Notion</option>
        </select>
        <input type="url" class="form-input link-url" placeholder="https://...">
        <input type="text" class="form-input link-label" placeholder="Label (optional)" style="width:140px;">
    `;
    container.appendChild(row);
}


// ──────────────────────────────────────────────
// JOIN FLOW — Onboarding Brief
// ──────────────────────────────────────────────

async function loadOnboardingBrief() {
    try {
        const result = await authGet('/api/v1/onboarding/onboarding-brief/' + encodeURIComponent(joinInviteCode));
        if (result && result.response.ok) {
            document.getElementById('brief_teamName').textContent = result.data.team_name;
            document.getElementById('brief_members').textContent = result.data.member_count + ' member(s)';
            document.getElementById('brief_info').textContent =
                result.data.project_info || 'The AI Brain will generate a full brief once initialized.';
        }
    } catch (err) {
        console.error('Failed to load brief:', err);
    }
}
