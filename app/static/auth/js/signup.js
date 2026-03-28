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
    const form = document.getElementById('signupForm');
    const submitButton = form?.querySelector('button[type="submit"]');
    const signupMessage = document.getElementById('signupMessage');
    // Removed verification card and resend logic. All verification is now handled on the dedicated verify-email page.

    if (form && submitButton) {
        form.addEventListener('submit', async (event) => {
            event.preventDefault();

            const email = document.getElementById('email').value.trim();
            const password = document.getElementById('password').value;
            const full_name = document.getElementById('full_name').value.trim();

            window.AuthUI.setMessage(signupMessage, '', '');
            window.AuthUI.setButtonLoading(submitButton, true, 'Sign Up', 'Creating Account...');

            try {
                const { response, data } = await window.AuthUI.postJson('/api/v1/signup', {
                    email,
                    password,
                    full_name
                });

                if (response.ok) {
                    window.localStorage.setItem('pendingVerificationEmail', email);
                    window.location.href = `/verify-email?email=${encodeURIComponent(email)}`;
                } else {
                    verificationCard.classList.add('is-hidden');
                    window.AuthUI.setMessage(signupMessage, 'error', data.detail || 'Signup failed');
                }
            } catch (error) {
                verificationCard.classList.add('is-hidden');
                window.AuthUI.setMessage(signupMessage, 'error', 'Network error');
            } finally {
                window.AuthUI.setButtonLoading(submitButton, false, 'Sign Up', 'Creating Account...');
            }
        });
    }

    // Removed resend button logic. All verification is now handled on the dedicated verify-email page.
});
