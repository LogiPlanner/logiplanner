document.addEventListener('DOMContentLoaded', async () => {
    const badge = document.getElementById('verificationBadge');
    const statusIcon = document.getElementById('statusIcon');
    const statusText = document.getElementById('statusText');
    const title = document.getElementById('verificationTitle');
    const subtitle = document.getElementById('verificationSubtitle');
    const message = document.getElementById('verificationMessage');
    const loginLink = document.getElementById('verificationLoginLink');
    const resendForm = document.getElementById('verifyResendForm');
    const resendButton = resendForm?.querySelector('button[type="submit"]');
    const resendInput = document.getElementById('verifyResendEmail');
    const resendMessage = document.getElementById('verifyResendMessage');

    const email = window.AuthUI.getQueryParam('email') || window.localStorage.getItem('pendingVerificationEmail') || '';
    const token = window.AuthUI.getQueryParam('token');

    if (email) {
        resendInput.value = email;
    }

    const icons = {
        pending: '<svg width="20" height="20" fill="none" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8" stroke="#FFA500" stroke-width="2" fill="#FFF8E1"/><circle cx="10" cy="10" r="4" fill="#FFA500"/></svg>',
        success: '<svg width="20" height="20" fill="none" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8" stroke="#4CAF50" stroke-width="2" fill="#E8F5E9"/><path d="M6 10.5l2.5 2.5L14 8" stroke="#4CAF50" stroke-width="2" stroke-linecap="round"/></svg>',
        error: '<svg width="20" height="20" fill="none" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8" stroke="#F44336" stroke-width="2" fill="#FFEBEE"/><path d="M7 7l6 6M13 7l-6 6" stroke="#F44336" stroke-width="2" stroke-linecap="round"/></svg>'
    };

    const setStatus = (tone, label, heading, body) => {
        badge.className = `status-badge status-badge--${tone}`;
        if (statusIcon && statusText) {
            statusIcon.innerHTML = icons[tone] || '';
            statusText.textContent = label;
        } else {
            badge.textContent = label;
        }
        title.textContent = heading;
        message.textContent = body;
    };

    if (token) {
        subtitle.textContent = 'Your link was opened successfully. We are validating it now.';

        try {
            const response = await fetch(`/api/v1/verify-email/${encodeURIComponent(token)}`);
            const data = await response.json();

            if (response.ok) {
                window.localStorage.removeItem('pendingVerificationEmail');
                setStatus('success', 'Verified', 'Email confirmed', data.message || 'Email verified successfully! You can now login.');
                loginLink.classList.remove('is-hidden');
                return;
            }

            setStatus('error', 'Failed', 'Verification failed', data.detail || 'Invalid or expired verification token.');
        } catch (error) {
            setStatus('error', 'Failed', 'Verification failed', 'Network error while verifying your email.');
        }
    } else {
        subtitle.textContent = 'No verification token was found in this page link.';
        setStatus('pending', 'Pending', 'Verification link required', 'Open the verification email you received, or request a new link below.');
    }

    if (resendForm && resendButton) {
        resendForm.addEventListener('submit', async (event) => {
            event.preventDefault();

            const resendEmail = resendInput.value.trim();
            window.AuthUI.setMessage(resendMessage, '', '');
            window.AuthUI.setButtonLoading(resendButton, true, 'Send new link', 'Sending...');

            try {
                const { response, data } = await window.AuthUI.postJson('/api/v1/resend-verification', { email: resendEmail });

                if (response.ok) {
                    window.localStorage.setItem('pendingVerificationEmail', resendEmail);
                    window.AuthUI.setMessage(resendMessage, 'success', data.message || 'Verification email sent.');
                    setStatus('pending', 'Pending', 'New verification link sent', 'Check your inbox and open the newest verification email.');
                } else {
                    window.AuthUI.setMessage(resendMessage, 'error', data.detail || 'Could not resend verification email.');
                }
            } catch (error) {
                window.AuthUI.setMessage(resendMessage, 'error', 'Network error');
            } finally {
                window.AuthUI.setButtonLoading(resendButton, false, 'Send new link', 'Sending...');
            }
        });
    }
});
