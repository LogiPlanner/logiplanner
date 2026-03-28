// Google OAuth login
async function googleLogin() {
    try {
        const res = await fetch('/api/v1/auth/google');
        const data = await res.json();
        window.location.href = data.url; // redirect to Google
    } catch (err) {
        alert('Failed to start Google login');
    }
}
document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('loginForm');
    const submitButton = form?.querySelector('button[type="submit"]');
    const loginMessage = document.getElementById('loginMessage');
    // Removed resend panel and related logic. All verification is now handled on the dedicated verify-email page.

    if (form && submitButton) {
        form.addEventListener('submit', async (event) => {
            event.preventDefault();

            const email = document.getElementById('email').value.trim();
            const password = document.getElementById('password').value;

            window.AuthUI.setMessage(loginMessage, '', '');
            window.AuthUI.setButtonLoading(submitButton, true, 'Log In', 'Logging In...');

            try {
                const { response, data } = await window.AuthUI.postJson('/api/v1/login', { email, password });

                if (response.ok) {
                    window.localStorage.removeItem('pendingVerificationEmail');
                    window.AuthUI.setMessage(loginMessage, 'success', 'Login successful. Your session is ready.');
                    resendPanel.classList.add('is-hidden');
                    console.log('Access token:', data.access_token);
                    return;
                }

                if (response.status === 403) {
                    window.localStorage.setItem('pendingVerificationEmail', email);
                    window.location.href = `/verify-email?email=${encodeURIComponent(email)}`;
                    return;
                }

                window.AuthUI.setMessage(loginMessage, 'error', data.detail || 'Login failed');
            } catch (error) {
                window.AuthUI.setMessage(loginMessage, 'error', 'Network error');
            } finally {
                window.AuthUI.setButtonLoading(submitButton, false, 'Log In', 'Logging In...');
            }
        });
    }

    // Removed resend form submit logic. All verification is now handled on the dedicated verify-email page.
});
