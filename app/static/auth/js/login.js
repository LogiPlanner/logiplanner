/* LogiPlanner — Login Page */
document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('loginForm');
    const btn = document.getElementById('loginBtn');
    const msg = document.getElementById('loginMessage');
    const toggle = document.getElementById('togglePassword');
    const passInput = document.getElementById('password');

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
