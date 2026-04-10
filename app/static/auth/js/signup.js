/* LogiPlanner — Signup Page */
document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('signupForm');
    const btn = document.getElementById('signupBtn');
    const msg = document.getElementById('signupMessage');
    const passInput = document.getElementById('password');
    const toggle = document.getElementById('togglePassword');

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
