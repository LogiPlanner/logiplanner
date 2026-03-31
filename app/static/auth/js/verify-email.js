/* LogiPlanner — Verify Email Page */
document.addEventListener('DOMContentLoaded', async () => {
    const statusCard = document.getElementById('statusCard');
    const statusIcon = document.getElementById('statusIcon');
    const statusText = document.getElementById('statusText');
    const title = document.getElementById('verificationTitle');
    const subtitle = document.getElementById('verificationSubtitle');
    const message = document.getElementById('verificationMessage');
    const loginLink = document.getElementById('verificationLoginLink');
    const resendForm = document.getElementById('verifyResendForm');
    const resendInput = document.getElementById('verifyResendEmail');
    const resendMessage = document.getElementById('verifyResendMessage');
    const resendBtn = resendForm?.querySelector('button[type="submit"]');

    const email = window.AuthUI.getQueryParam('email') || localStorage.getItem('pendingVerificationEmail') || '';
    const token = window.AuthUI.getQueryParam('token');

    if (email && resendInput) resendInput.value = email;

    const icons = {
        pending: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="8" stroke="#f59e0b" stroke-width="2" fill="#fef3c7"/><circle cx="10" cy="10" r="4" fill="#f59e0b"/></svg>',
        success: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="8" stroke="#10b981" stroke-width="2" fill="#d1fae5"/><path d="M6 10.5l2.5 2.5L14 8" stroke="#10b981" stroke-width="2" stroke-linecap="round"/></svg>',
        error: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="8" stroke="#ef4444" stroke-width="2" fill="#fee2e2"/><path d="M7 7l6 6M13 7l-6 6" stroke="#ef4444" stroke-width="2" stroke-linecap="round"/></svg>'
    };

    function setStatus(tone, label, heading, body) {
        statusCard.className = 'status-card status-card--' + tone;
        if (statusIcon) statusIcon.innerHTML = icons[tone] || '';
        if (statusText) statusText.textContent = label;
        if (title) title.textContent = heading;
        if (message) message.textContent = body;
    }

    if (token) {
        if (subtitle) subtitle.textContent = 'Validating your verification link...';
        try {
            const res = await fetch('/api/v1/verify-email/' + encodeURIComponent(token));
            const data = await res.json();
            if (res.ok) {
                localStorage.removeItem('pendingVerificationEmail');
                setStatus('success', 'Verified', 'Email Confirmed! ✓', data.message || 'Your email has been verified. You can now sign in.');
                loginLink.classList.remove('hidden');
                return;
            }
            setStatus('error', 'Failed', 'Verification Failed', data.detail || 'Invalid or expired token.');
        } catch (err) {
            setStatus('error', 'Failed', 'Verification Failed', 'Network error while verifying.');
        }
    } else {
        // First, check if the email exists in the database
        if (email) {
            try {
                const res = await fetch('/api/v1/verification-status/' + encodeURIComponent(email));
                if (res.status === 404) {
                    setStatus('error', 'Not Found', 'Email Not Registered', 'This email is not registered. Please check for typos or sign up first.');
                    if (resendForm) resendForm.style.display = 'none';
                    if (subtitle) subtitle.textContent = '';
                    const signupLink = document.getElementById('verificationSignupLink');
                    if (signupLink) signupLink.classList.remove('hidden');
                    return;
                }
            } catch (e) {
                setStatus('error', 'Not Found', 'Email Not Registered', 'Could not check email status.');
                if (resendForm) resendForm.style.display = 'none';
                if (subtitle) subtitle.textContent = '';
                return;
            }
            
            setStatus('pending', 'Pending', 'Check Your Inbox', 'Open the verification email and click the link to continue.');
            if (subtitle) subtitle.textContent = 'We sent a verification link to ' + email;

            // Background polling for verification status
            const checkStatus = async () => {
                try {
                    const res = await fetch('/api/v1/verification-status/' + encodeURIComponent(email));
                    const data = await res.json();
                    if (res.ok && data.is_verified) {
                        if (window.verificationInterval) clearInterval(window.verificationInterval);
                        localStorage.removeItem('pendingVerificationEmail');
                        setStatus('success', 'Verified', 'Email Confirmed! ✓', 'Your email has been verified. You can now sign in.');
                        if (loginLink) loginLink.classList.remove('hidden');
                        if (subtitle) subtitle.textContent = 'Account high-five! You are ready to go.';
                        return true;
                    }
                } catch (e) {
                    // Silently fail polling errors
                }
                return false;
            };

            // Immediate check
            const alreadyVerified = await checkStatus();
            if (alreadyVerified) return;

            let pollCount = 0;
            const maxPolls = 60; // Poll for 5 minutes (every 5 seconds)
            window.verificationInterval = setInterval(async () => {
                pollCount++;
                if (pollCount > maxPolls) {
                    clearInterval(window.verificationInterval);
                    return;
                }
                await checkStatus();
            }, 5000);
        } else {
            // No token and no email provided
            statusCard.style.display = 'none';
            if (title) title.textContent = 'Verify Your Email';
            if (subtitle) subtitle.textContent = 'Enter your email below to request a verification link.';
        }
    }

    // Resend form
    if (resendForm && resendBtn) {
        resendForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const resendEmail = resendInput.value.trim();
            window.AuthUI.setMessage(resendMessage, '', '');
            window.AuthUI.setButtonLoading(resendBtn, true, 'Resend', 'Sending...');
            try {
                const { response, data } = await window.AuthUI.postJson('/api/v1/resend-verification', { email: resendEmail });
                if (response.ok) {
                    localStorage.setItem('pendingVerificationEmail', resendEmail);
                    window.AuthUI.setMessage(resendMessage, 'success', data.message || 'Verification email sent!');
                    
                    statusCard.style.display = 'block'; // Ensure it's visible
                    
                    if (data.message === 'Email already verified') {
                        setStatus('success', 'Verified', 'Already Verified!', 'Your email was already confirmed. You can sign in now.');
                        if (loginLink) loginLink.classList.remove('hidden');
                        if (subtitle) subtitle.textContent = 'Account high-five! You are ready to go.';
                    } else {
                        setStatus('pending', 'Pending', 'New Link Sent', 'Check your inbox for the newest verification email.');
                        if (loginLink) loginLink.classList.add('hidden');
                    }
                } else {
                    window.AuthUI.setMessage(resendMessage, 'error', data.detail || 'Could not resend.');
                }
            } catch (err) {
                window.AuthUI.setMessage(resendMessage, 'error', 'Network error.');
            } finally {
                window.AuthUI.setButtonLoading(resendBtn, false, 'Resend', 'Sending...');
            }
        });
    }
});
