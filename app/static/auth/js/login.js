/* LogiPlanner — Login Page */
document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('loginForm');
    const btn = document.getElementById('loginBtn');
    const msg = document.getElementById('loginMessage');
    const toggle = document.getElementById('togglePassword');
    const passInput = document.getElementById('password');

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
            toggle.setAttribute('aria-label', isPass ? 'Hide password' : 'Show password');
        });
    }

    // Google OAuth — direct redirect (server returns 302)
    document.getElementById('googleBtn')?.addEventListener('click', () => {
        window.location.href = '/api/v1/google';
    });

    // Check for OAuth errors in URL
    const error = window.AuthUI.getQueryParam('error');
    if (error) {
        window.AuthUI.setMessage(msg, 'error', 'Google sign-in failed: ' + error.replace(/_/g, ' '));
    }

    // Login form submit
    if (form && btn) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('email').value.trim();
            const password = passInput.value;

            window.AuthUI.setMessage(msg, '', '');
            window.AuthUI.setButtonLoading(btn, true, 'Sign in', 'Signing in...');

            try {
                const { response, data } = await window.AuthUI.postJson('/api/v1/login', { email, password });

                if (response.ok) {
                    localStorage.setItem('access_token', data.access_token);
                    localStorage.setItem('refresh_token', data.refresh_token);
                    localStorage.removeItem('pendingVerificationEmail');
                    window.AuthUI.setMessage(msg, 'success', 'Login successful! Redirecting...');

                    // Check profile / team status
                    try {
                        const status = await window.AuthUI.getJson('/api/v1/profile-status');
                        if (status.response.ok) {
                            const step = status.data.next_step;
                            if (step === 'complete_profile') window.location.href = '/onboarding';
                            else if (step === 'team_selection') window.location.href = '/onboarding';
                            else window.location.href = '/dashboard';
                            return;
                        }
                    } catch(e) {}
                    window.location.href = '/dashboard';
                    return;
                }

                if (response.status === 403) {
                    localStorage.setItem('pendingVerificationEmail', email);
                    window.location.href = '/verify-email?email=' + encodeURIComponent(email);
                    return;
                }

                window.AuthUI.setMessage(msg, 'error', data.detail || 'Login failed');
            } catch (err) {
                window.AuthUI.setMessage(msg, 'error', 'Network error. Please try again.');
            } finally {
                window.AuthUI.setButtonLoading(btn, false, 'Sign in', 'Signing in...');
            }
        });
    }
});
