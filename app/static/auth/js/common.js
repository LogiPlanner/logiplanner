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

    /** Try to get a new access token using the stored refresh token. */
    async _tryRefresh() {
        const rt = localStorage.getItem('refresh_token');
        if (!rt) return false;
        try {
            const res = await fetch('/api/v1/refresh', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refresh_token: rt }),
            });
            if (!res.ok) return false;
            const data = await res.json();
            localStorage.setItem('access_token', data.access_token);
            localStorage.setItem('refresh_token', data.refresh_token);
            return true;
        } catch { return false; }
    },

    /** Redirect to login after clearing tokens. */
    _forceLogout() {
        window.__lpStorage.clearAll();
        window.location.href = '/login';
    },

    async getJson(url) {
        const token = localStorage.getItem('access_token');
        const headers = {};
        if (token) headers['Authorization'] = 'Bearer ' + token;
        let res = await fetch(url, { headers });

        // If 401, try refreshing the token once
        if (res.status === 401) {
            const refreshed = await this._tryRefresh();
            if (refreshed) {
                headers['Authorization'] = 'Bearer ' + localStorage.getItem('access_token');
                res = await fetch(url, { headers });
            } else {
                this._forceLogout();
                return { response: res, data: {} };
            }
        }

        let data = {};
        try { data = await res.json(); } catch(e) {}
        return { response: res, data };
    },

    getQueryParam(name) {
        return new URLSearchParams(window.location.search).get(name) || '';
    },

    storeTokenFromUrl() {
        const token = this.getQueryParam('token');
        const refresh = this.getQueryParam('refresh_token');
        if (token) {
            localStorage.setItem('access_token', token);
            if (refresh) localStorage.setItem('refresh_token', refresh);
            window.history.replaceState({}, document.title, window.location.pathname);
        }
    }
};
