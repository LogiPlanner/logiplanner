window.AuthUI = {
    setMessage(element, tone, text) {
        if (!element) {
            return;
        }

        element.className = 'message';
        if (tone) {
            element.classList.add(`is-${tone}`);
        }
        element.textContent = text || '';
    },

    setButtonLoading(button, isLoading, idleText, loadingText) {
        if (!button) {
            return;
        }

        button.disabled = isLoading;
        button.textContent = isLoading ? loadingText : idleText;
    },

    async postJson(url, payload) {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        let data = {};
        try {
            data = await response.json();
        } catch (error) {
            data = {};
        }

        return { response, data };
    },

    getQueryParam(name) {
        return new URLSearchParams(window.location.search).get(name) || '';
    }
};
