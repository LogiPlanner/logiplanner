/* LogiPlanner — Common Auth Utilities */
window.AuthUI = {
    setMessage(el, tone, text) {
        if (!el) return;
        el.className = 'message';
        if (tone) el.classList.add('message--' + tone);
        el.textContent = text || '';
    },

    setButtonLoading(btn, loading, idleText, loadingText) {
        if (!btn) return;
        btn.disabled = loading;
        btn.innerHTML = loading
            ? '<span class="spinner"></span> ' + (loadingText || 'Loading...')
            : (idleText || 'Submit');
    },

    async postJson(url, payload) {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        let data = {};
        try { data = await res.json(); } catch(e) {}
        return { response: res, data };
    },

    async getJson(url) {
        const token = localStorage.getItem('access_token');
        const headers = {};
        if (token) headers['Authorization'] = 'Bearer ' + token;
        const res = await fetch(url, { headers });
        let data = {};
        try { data = await res.json(); } catch(e) {}
        return { response: res, data };
    },

    getQueryParam(name) {
        return new URLSearchParams(window.location.search).get(name) || '';
    },

    storeTokenFromUrl() {
        const token = this.getQueryParam('token');
        if (token) {
            localStorage.setItem('access_token', token);
            window.history.replaceState({}, document.title, window.location.pathname);
        }
    }
};
