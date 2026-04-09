/* LogiPlanner — Signup Page */
document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('signupForm');
    const btn = document.getElementById('signupBtn');
    const msg = document.getElementById('signupMessage');
    const passInput = document.getElementById('password');
    const toggle = document.getElementById('togglePassword');

    // ── Check if already logged in ──
    const existingToken = localStorage.getItem('access_token');
    if (existingToken) {
        (async function checkSession() {
            try {
                const res = await fetch('/api/v1/profile-status', {
                    headers: { 'Authorization': 'Bearer ' + existingToken }
                });
                if (!res.ok) return;

                const data = await res.json();

                // Smart display name: full_name > email username > email
                const email = data.email || '';
                const emailUser = email.includes('@') ? email.split('@')[0] : email;
                const displayName = data.full_name || emailUser || 'User';
                const initial = displayName.charAt(0).toUpperCase();

                // Populate card
                const nameEl  = document.getElementById('loggedInName');
                const emailEl = document.getElementById('loggedInEmail');
                const avatarEl = document.getElementById('albAvatar');
                if (nameEl)  nameEl.textContent  = displayName;
                if (emailEl) emailEl.textContent = email;
                if (avatarEl) avatarEl.textContent = initial;

                // Update page heading to match context
                const heading = document.querySelector('.auth-form-container__heading');
                const subtext = document.querySelector('.auth-form-container__subtext');
                const container = document.querySelector('.auth-form-container');
                if (heading) heading.textContent = 'You’re already signed in';
                if (subtext) subtext.textContent = 'Your session is still active. Jump back in.';
                if (container) container.classList.add('alb-active');

                // Show banner, hide form elements
                const banner = document.getElementById('alreadyLoggedInBanner');
                if (banner) banner.style.display = 'block';
                if (form) form.style.display = 'none';
                document.querySelector('.auth-divider')?.style.setProperty('display', 'none');
                document.getElementById('googleBtn')?.style.setProperty('display', 'none');
                document.querySelector('.auth-footer-text')?.style.setProperty('display', 'none');

                // Auto-redirect countdown (3s)
                const dest = data.next_step === 'dashboard' ? '/dashboard' : '/onboarding';
                const countdownEl = document.getElementById('albCountdown');
                let secs = 3;
                if (countdownEl) {
                    countdownEl.textContent = `Taking you to your dashboard in ${secs}…`;
                    const ticker = setInterval(() => {
                        secs--;
                        if (secs <= 0) {
                            clearInterval(ticker);
                            window.location.href = dest;
                        } else {
                            countdownEl.textContent = `Taking you to your dashboard in ${secs}…`;
                        }
                    }, 1000);

                    // Let the CTA button cancel the auto-redirect
                    document.getElementById('albCtaBtn')?.addEventListener('click', (e) => {
                        clearInterval(ticker);
                    });
                }

                // Switch account — clear timer + tokens
                document.getElementById('switchAccountBtn')?.addEventListener('click', () => {
                    localStorage.removeItem('access_token');
                    localStorage.removeItem('refresh_token');
                    localStorage.removeItem('selected_team_id');
                    location.reload();
                });

            } catch {}
        })();
    }

    // Password visibility toggle
    if (toggle && passInput) {
        toggle.addEventListener('click', () => {
            const isPass = passInput.type === 'password';
            passInput.type = isPass ? 'text' : 'password';
        });
    }

    // Password strength
    if (passInput) {
        passInput.addEventListener('input', () => {
            const val = passInput.value;
            const bars = [document.getElementById('str1'), document.getElementById('str2'), document.getElementById('str3'), document.getElementById('str4')];
            const text = document.getElementById('strengthText');
            let score = 0;
            if (val.length >= 6) score++;
            if (val.length >= 10) score++;
            if (/[A-Z]/.test(val) && /[a-z]/.test(val)) score++;
            if (/[0-9]/.test(val) || /[^A-Za-z0-9]/.test(val)) score++;

            const levels = ['', 'Weak', 'Fair', 'Good', 'Strong'];
            const classes = ['', 'active-weak', 'active-medium', 'active-medium', 'active-strong'];
            const colors = ['', 'var(--color-error)', 'var(--color-warning)', 'var(--color-warning)', 'var(--color-success)'];

            bars.forEach((bar, i) => {
                bar.className = 'password-strength__bar';
                if (i < score) bar.classList.add(classes[score]);
            });
            if (text) {
                text.textContent = val.length > 0 ? levels[score] : '';
                text.style.color = colors[score];
            }
        });
    }

    // Google OAuth
    document.getElementById('googleBtn')?.addEventListener('click', () => {
        window.location.href = '/api/v1/google';
    });

    // Signup submit
    if (form && btn) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('email').value.trim();
            const password = passInput.value;

            if (password.length < 6) {
                window.AuthUI.setMessage(msg, 'error', 'Password must be at least 6 characters.');
                return;
            }

            window.AuthUI.setMessage(msg, '', '');
            window.AuthUI.setButtonLoading(btn, true, 'Create account', 'Creating...');

            try {
                const { response, data } = await window.AuthUI.postJson('/api/v1/signup', { email, password });

                if (response.ok) {
                    localStorage.setItem('pendingVerificationEmail', email);
                    window.location.href = '/verify-email?email=' + encodeURIComponent(email);
                } else {
                    window.AuthUI.setMessage(msg, 'error', data.detail || 'Signup failed');
                }
            } catch (err) {
                window.AuthUI.setMessage(msg, 'error', 'Network error. Please try again.');
            } finally {
                window.AuthUI.setButtonLoading(btn, false, 'Create account', 'Creating...');
            }
        });
    }
});
