/* LogiPlanner — Verify Email Page (OTP Code Flow) */
document.addEventListener('DOMContentLoaded', () => {
    const subtitle        = document.getElementById('verificationSubtitle');
    const codeEntrySection = document.getElementById('codeEntrySection');
    const successSection  = document.getElementById('successSection');
    const signupLink      = document.getElementById('verificationSignupLink');
    const resendSection   = document.getElementById('resendSection');
    const verifyBtn       = document.getElementById('verifyCodeBtn');
    const codeError       = document.getElementById('codeError');
    const otpDigits       = Array.from(document.querySelectorAll('.otp-digit'));
    const resendForm      = document.getElementById('verifyResendForm');
    const resendInput     = document.getElementById('verifyResendEmail');
    const resendMessage   = document.getElementById('verifyResendMessage');
    const resendBtn       = resendForm?.querySelector('button[type="submit"]');

    const email = window.AuthUI.getQueryParam('email') || localStorage.getItem('pendingVerificationEmail') || '';

    if (email && resendInput) resendInput.value = email;
    if (email && subtitle) subtitle.textContent = `We sent a 6-digit code to ${email}. Enter it below.`;

    otpDigits.forEach((input, idx) => {
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace') {
                if (input.value) {
                    input.value = '';
                    input.classList.remove('otp-digit--filled');
                } else if (idx > 0) {
                    otpDigits[idx - 1].focus();
                }
                e.preventDefault();
                clearError();
            } else if (e.key === 'ArrowLeft' && idx > 0) {
                otpDigits[idx - 1].focus();
                e.preventDefault();
            } else if (e.key === 'ArrowRight' && idx < otpDigits.length - 1) {
                otpDigits[idx + 1].focus();
                e.preventDefault();
            } else if (e.key === 'Enter') {
                submitCode();
            }
        });

        input.addEventListener('input', () => {
            const val = input.value.replace(/\D/g, '');
            input.value = val ? val[val.length - 1] : '';
            clearError();
            if (input.value) {
                input.classList.add('otp-digit--filled');
                if (idx < otpDigits.length - 1) otpDigits[idx + 1].focus();
            } else {
                input.classList.remove('otp-digit--filled');
            }
        });

        // Handle paste anywhere in the OTP group
        input.addEventListener('paste', (e) => {
            e.preventDefault();
            const pasted = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '');
            if (!pasted) return;
            otpDigits.forEach((d, i) => {
                d.value = pasted[i] || '';
                d.classList.toggle('otp-digit--filled', !!d.value);
            });
            const lastFilled = Math.min(pasted.length, otpDigits.length) - 1;
            otpDigits[lastFilled].focus();
            clearError();
        });
    });

    // Auto-focus first digit on load
    if (otpDigits[0]) otpDigits[0].focus();

    // ── Helpers ───────────────────────────────────────────────────────
    function getCode() {
        return otpDigits.map(d => d.value).join('');
    }

    function clearError() {
        if (codeError) { codeError.textContent = ''; codeError.className = 'message'; }
        otpDigits.forEach(d => d.classList.remove('otp-digit--error'));
    }

    function showError(msg) {
        if (codeError) { codeError.textContent = msg; codeError.className = 'message message--error'; }
        otpDigits.forEach(d => d.classList.add('otp-digit--error'));
    }

    function showSuccess() {
        if (codeEntrySection) codeEntrySection.classList.add('hidden');
        if (successSection)   successSection.classList.remove('hidden');
        if (resendSection)    resendSection.style.display = 'none';
        if (subtitle) subtitle.textContent = 'Account high-five! You are ready to go.';
        localStorage.removeItem('pendingVerificationEmail');
    }

    // ── Submit code ───────────────────────────────────────────────────
    async function submitCode() {
        const code        = getCode();
        const verifyEmail = email || resendInput?.value.trim() || '';

        if (code.length < 6) {
            showError('Please enter all 6 digits.');
            return;
        }
        if (!verifyEmail) {
            showError('Email address is missing. Use the resend form below to get a new code.');
            return;
        }

        window.AuthUI.setButtonLoading(verifyBtn, true, 'Verify Code', 'Verifying...');
        clearError();

        try {
            const { response, data } = await window.AuthUI.postJson('/api/v1/verify-email', {
                email: verifyEmail,
                code,
            });

            if (response.ok) {
                showSuccess();
            } else if (response.status === 400) {
                showError(data.detail || 'Invalid or expired code. Request a new one below.');
                otpDigits.forEach(d => { d.value = ''; d.classList.remove('otp-digit--filled'); });
                otpDigits[0].focus();
            } else {
                showError(data.detail || 'Something went wrong. Please try again.');
            }
        } catch (err) {
            showError('Network error. Please check your connection and try again.');
        } finally {
            window.AuthUI.setButtonLoading(verifyBtn, false, 'Verify Code', 'Verifying...');
        }
    }

    if (verifyBtn) verifyBtn.addEventListener('click', submitCode);

    // ── Resend form ───────────────────────────────────────────────────
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
                    if (data.message === 'Email already verified') {
                        window.AuthUI.setMessage(resendMessage, 'success', 'Your email is already verified. You can sign in.');
                        showSuccess();
                    } else {
                        window.AuthUI.setMessage(resendMessage, 'success', 'New code sent! Check your inbox.');
                        // Clear OTP inputs ready for new code
                        otpDigits.forEach(d => { d.value = ''; d.classList.remove('otp-digit--filled', 'otp-digit--error'); });
                        otpDigits[0].focus();
                        clearError();
                        if (subtitle) subtitle.textContent = `We sent a new 6-digit code to ${resendEmail}.`;
                    }
                } else {
                    window.AuthUI.setMessage(resendMessage, 'error', data.detail || 'Could not resend. Please try again.');
                }
            } catch (err) {
                window.AuthUI.setMessage(resendMessage, 'error', 'Network error.');
            } finally {
                window.AuthUI.setButtonLoading(resendBtn, false, 'Resend', 'Sending...');
            }
        });
    }
});

