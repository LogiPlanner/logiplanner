/* LogiPlanner — Profile Completion Page */
document.addEventListener('DOMContentLoaded', () => {
    // Store token from URL if coming from Google OAuth
    window.AuthUI.storeTokenFromUrl();

    const form = document.getElementById('profileForm');
    const btn = document.getElementById('profileBtn');
    const msg = document.getElementById('profileMessage');
    const nameInput = document.getElementById('full_name');
    const avatarPreview = document.getElementById('avatarPreview');

    // Live avatar initials preview
    if (nameInput && avatarPreview) {
        nameInput.addEventListener('input', () => {
            const name = nameInput.value.trim();
            if (name) {
                const parts = name.split(' ').filter(Boolean);
                const initials = parts.length > 1
                    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
                    : parts[0][0].toUpperCase();
                avatarPreview.textContent = initials;
            } else {
                avatarPreview.textContent = '?';
            }
        });
    }

    if (form && btn) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const token = localStorage.getItem('access_token');
            if (!token) {
                window.AuthUI.setMessage(msg, 'error', 'You must be logged in. Please sign in first.');
                setTimeout(() => { window.location.href = '/login'; }, 1500);
                return;
            }

            const full_name = nameInput.value.trim();
            const job_title = document.getElementById('job_title').value.trim();
            const role_preference = document.getElementById('role_preference').value;

            window.AuthUI.setMessage(msg, '', '');
            window.AuthUI.setButtonLoading(btn, true, 'Continue', 'Saving...');

            try {
                const res = await fetch('/api/v1/complete-profile', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + token
                    },
                    body: JSON.stringify({ full_name, job_title, role_preference })
                });
                const data = await res.json();

                if (res.ok) {
                    window.AuthUI.setMessage(msg, 'success', 'Profile saved! Setting up your team...');
                    setTimeout(() => { window.location.href = '/team-select'; }, 800);
                } else {
                    window.AuthUI.setMessage(msg, 'error', data.detail || 'Failed to save profile.');
                }
            } catch (err) {
                window.AuthUI.setMessage(msg, 'error', 'Network error.');
            } finally {
                window.AuthUI.setButtonLoading(btn, false, 'Continue', 'Saving...');
            }
        });
    }
});
