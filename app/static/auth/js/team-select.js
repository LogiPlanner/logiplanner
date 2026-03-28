/* LogiPlanner — Team Selection Page */
let selectedOption = null;

function selectOption(option) {
    selectedOption = option;
    document.getElementById('optionCreate').classList.toggle('active', option === 'create');
    document.getElementById('optionJoin').classList.toggle('active', option === 'join');
    document.getElementById('createForm').classList.toggle('hidden', option !== 'create');
    document.getElementById('joinForm').classList.toggle('hidden', option !== 'join');
    document.getElementById('teamMessage').textContent = '';
}

async function previewTeam() {
    const code = document.getElementById('inviteCode').value.trim();
    const msg = document.getElementById('teamMessage');
    const previewDiv = document.getElementById('teamPreview');

    if (!code) {
        window.AuthUI.setMessage(msg, 'error', 'Please enter an invite code.');
        return;
    }

    window.AuthUI.setMessage(msg, '', '');
    const btn = document.getElementById('previewBtn');
    window.AuthUI.setButtonLoading(btn, true, 'Preview Team', 'Looking up...');

    try {
        const res = await fetch('/api/v1/team-preview/' + encodeURIComponent(code));
        const data = await res.json();

        if (res.ok) {
            document.getElementById('previewName').textContent = data.team_name;
            document.getElementById('previewMeta').textContent =
                data.description + ' · ' + data.member_count + ' member' + (data.member_count !== 1 ? 's' : '');
            previewDiv.classList.remove('hidden');
        } else {
            window.AuthUI.setMessage(msg, 'error', data.detail || 'Team not found.');
            previewDiv.classList.add('hidden');
        }
    } catch (err) {
        window.AuthUI.setMessage(msg, 'error', 'Network error.');
    } finally {
        window.AuthUI.setButtonLoading(btn, false, 'Preview Team', 'Looking up...');
    }
}

async function joinTeam() {
    const code = document.getElementById('inviteCode').value.trim();
    const msg = document.getElementById('teamMessage');
    const token = localStorage.getItem('access_token');
    if (!token) { window.location.href = '/login'; return; }

    const btn = document.getElementById('joinBtn');
    window.AuthUI.setButtonLoading(btn, true, 'Join This Team', 'Joining...');

    try {
        const res = await fetch('/api/v1/join-team', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ invite_code: code })
        });
        const data = await res.json();

        if (res.ok) {
            window.AuthUI.setMessage(msg, 'success', data.message || 'Joined successfully!');
            setTimeout(() => { window.location.href = '/dashboard'; }, 1000);
        } else {
            window.AuthUI.setMessage(msg, 'error', data.detail || 'Could not join team.');
        }
    } catch (err) {
        window.AuthUI.setMessage(msg, 'error', 'Network error.');
    } finally {
        window.AuthUI.setButtonLoading(btn, false, 'Join This Team', 'Joining...');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.AuthUI.storeTokenFromUrl();

    const token = localStorage.getItem('access_token');
    if (!token) { window.location.href = '/login'; return; }

    // Create team form
    const createForm = document.getElementById('createTeamForm');
    if (createForm) {
        createForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const msg = document.getElementById('teamMessage');
            const btn = document.getElementById('createBtn');
            const teamName = document.getElementById('teamName').value.trim();
            const teamDesc = document.getElementById('teamDesc').value.trim();

            window.AuthUI.setMessage(msg, '', '');
            window.AuthUI.setButtonLoading(btn, true, 'Create Team & Continue', 'Creating...');

            try {
                const res = await fetch('/api/v1/create-team', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                    body: JSON.stringify({ team_name: teamName, description: teamDesc })
                });
                const data = await res.json();

                if (res.ok) {
                    createForm.classList.add('hidden');
                    document.getElementById('createResult').classList.remove('hidden');
                    document.getElementById('inviteCodeDisplay').textContent = data.invite_code;
                    window.AuthUI.setMessage(msg, '', '');
                } else {
                    window.AuthUI.setMessage(msg, 'error', data.detail || 'Could not create team.');
                }
            } catch (err) {
                window.AuthUI.setMessage(msg, 'error', 'Network error.');
            } finally {
                window.AuthUI.setButtonLoading(btn, false, 'Create Team & Continue', 'Creating...');
            }
        });
    }
});
