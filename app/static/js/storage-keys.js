/* ═══════════════════════════════════════════════════════════════
   LogiPlanner — Storage Key Constants
   Loaded on every page (auth + app) before any other script that
   touches localStorage / sessionStorage.
   ═══════════════════════════════════════════════════════════════ */
(function () {
    var KEYS = {
        ACCESS_TOKEN:               'access_token',
        REFRESH_TOKEN:              'refresh_token',
        SELECTED_TEAM_ID:           'selected_team_id',
        PENDING_VERIFICATION_EMAIL: 'pendingVerificationEmail',
        PENDING_SETUP:              'lp_pending_setup',   /* sessionStorage */
    };

    window.__lpStorage = {
        KEYS: KEYS,

        /** Remove every auth-related entry from local and session storage. */
        clearAll: function () {
            localStorage.removeItem(KEYS.ACCESS_TOKEN);
            localStorage.removeItem(KEYS.REFRESH_TOKEN);
            localStorage.removeItem(KEYS.SELECTED_TEAM_ID);
            localStorage.removeItem(KEYS.PENDING_VERIFICATION_EMAIL);
            sessionStorage.removeItem(KEYS.PENDING_SETUP);
        },
    };
})();
