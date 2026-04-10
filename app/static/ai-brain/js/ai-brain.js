/**
 * AI Brain v2 - Frontend Logic
 * =============================
 * - Chat Mode / Studio Mode toggle
 * - User-scoped private chat (NOT team chat)
 * - RBAC: owner/editor can manage KB, viewer can only chat
 * - Mobile responsive sidebar
 */

document.addEventListener('DOMContentLoaded', () => {
    // Auth Guard
    let token = localStorage.getItem('access_token');
    if (!token) { window.location.href = '/login'; return; }

    const API = '/api/v1';
    const authHeader = () => ({ 'Authorization': `Bearer ${localStorage.getItem('access_token')}` });
    const jsonHeaders = () => ({
        'Authorization': `Bearer ${localStorage.getItem('access_token')}`,
        'Content-Type': 'application/json',
    });

    // Use the shared authFetch from common.js (handles token refresh + logout)
    const aiFetch = (url, opts = {}) => window.__lp.authFetch(url, opts);

    // State
    let currentTeamId = null;
    let currentRole = 'viewer';
    let currentMode = 'chat'; // 'chat' or 'studio'
    let isTyping = false;
    let hasMessages = false;
    let currentSessionId = generateSessionId();

    function generateSessionId() {
        return 'xxxx-xxxx-xxxx'.replace(/x/g, () =>
            Math.floor(Math.random() * 16).toString(16)
        );
    }

    // DOM
    const teamSelect = document.getElementById('teamSelect');
    const roleBadge = document.getElementById('roleBadge');
    const brainContent = document.getElementById('brainContent');
    const kbPanel = document.getElementById('kbPanel');
    const chatPanel = document.getElementById('chatPanel');
    const chatMessages = document.getElementById('chatMessages');
    const chatWelcome = document.getElementById('chatWelcome');
    const chatInput = document.getElementById('chatInput');
    const chatSendBtn = document.getElementById('chatSendBtn');
    const quickPromptButtons = document.querySelectorAll('.chat-quick-prompt');
    const deleteChatBtn = document.getElementById('deleteChatBtn');
    const newChatBtn = document.getElementById('newChatBtn');
    const chatModeBtn = null;
    const studioModeBtn = null;
    const modeToggle = null;
    const kbUploadZone = document.getElementById('kbUploadZone');
    const fileInput = document.getElementById('kbFileInput');
    const docsList = document.getElementById('kbDocsList');
    const docsEmpty = document.getElementById('kbDocsEmpty');
    const statDocs = document.getElementById('statDocs');
    const statChunks = document.getElementById('statChunks');

    // Recent Chats panel
    const recentChatsPanel = document.getElementById('recentChatsPanel');
    const recentChatsList = document.getElementById('recentChatsList');
    const recentChatsEmpty = document.getElementById('recentChatsEmpty');
    const recentChatsToggle = document.getElementById('recentChatsToggle');

    // Initial mode
    brainContent.classList.add('mode-chat');
    chatMessages.style.display = 'none';

    // Mobile sidebar
    // MOBILE SIDEBAR
    const mobileToggle = document.getElementById('mobileToggle');
    const sidebar = document.getElementById('mainSidebar');
    const overlay = document.getElementById('sidebarOverlay');

    if (mobileToggle && sidebar) {
        mobileToggle.addEventListener('click', () => {
            sidebar.classList.toggle('open');
            overlay?.classList.toggle('active');
        });
    }

    if (overlay) {
        overlay.addEventListener('click', () => {
            sidebar.classList.remove('open');
            overlay.classList.remove('active');
        });
    }

    // Logout
    // LOGOUT
    document.getElementById('logoutBtn')?.addEventListener('click', () => {
        window.__lpStorage.clearAll();
        window.location.href = '/login';
    });

    // Team loading and role
    // TEAM LOADING & ROLE
    function getInitials(name) {
        if (!name) return 'U';
        return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
    }

    async function loadUserProfile() {
        try {
            const res = await aiFetch(`${API}/profile-status`, { headers: authHeader() });
            if (!res.ok) return;
            const profile = await res.json();
            const avatarEl = document.getElementById('avatarInitials');
            if (avatarEl) avatarEl.textContent = getInitials(profile.full_name || '');
        } catch (e) {
            console.error('Error loading profile:', e);
        }
    }

    async function loadTeams() {
        loadUserProfile();
        try {
            const res = await aiFetch(`${API}/onboarding/my-teams`, { headers: authHeader() });
            if (!res.ok) return;
            const data = await res.json();

            if (data.teams && data.teams.length > 0) {
                teamSelect.innerHTML = '';
                const savedTeam = localStorage.getItem('selected_team_id');
                data.teams.forEach(t => {
                    const opt = document.createElement('option');
                    opt.value = t.id;
                    opt.textContent = t.team_name;
                    opt.dataset.role = t.role || 'viewer';
                    if (savedTeam && parseInt(savedTeam) === t.id) opt.selected = true;
                    teamSelect.appendChild(opt);
                });
                const matchedTeam = savedTeam && data.teams.find(t => t.id === parseInt(savedTeam));
                currentTeamId = matchedTeam ? matchedTeam.id : data.teams[0].id;
                currentRole = matchedTeam ? (matchedTeam.role || 'viewer') : (data.teams[0].role || 'viewer');
                teamSelect.value = currentTeamId;
                localStorage.setItem('selected_team_id', currentTeamId);
                applyRole();
                loadAll();
            } else {
                teamSelect.innerHTML = '<option>No teams yet</option>';
            }
        } catch (e) {
            console.error('Error loading teams:', e);
        }
    }

    teamSelect.addEventListener('change', () => {
        const selected = teamSelect.selectedOptions[0];
        currentTeamId = parseInt(teamSelect.value);
        currentRole = selected?.dataset.role || 'viewer';
        localStorage.setItem('selected_team_id', currentTeamId);
        applyRole();
        loadAll();
    });

    function applyRole() {
        // Update badge
        roleBadge.textContent = currentRole;
        roleBadge.className = `role-badge role-badge--${currentRole}`;

        // Studio mode: only owner/editor
        const canEdit = currentRole === 'owner' || currentRole === 'editor';

        // Upload zone visibility
        if (kbUploadZone) {
            kbUploadZone.classList.toggle('hidden', !canEdit);
        }
    }

    function loadAll() {
        if (!currentTeamId) return;
        loadDocuments();
        loadStats();
        loadChatHistory();
    }

    // Mode toggle
    // MODE TOGGLE (ai-brain is always Chat; Studio is at /studio)
    function switchMode(mode) {
        currentMode = mode;
        brainContent.classList.remove('mode-chat', 'mode-studio');
        brainContent.classList.add(`mode-${mode}`);
    }

    // Knowledge base documents
    // KNOWLEDGE BASE: DOCUMENTS
    let _pollAttempts = 0;
    const _MAX_POLL_ATTEMPTS = 20; // stop after ~60s

    async function loadDocuments(isPolled = false) {
        try {
            const res = await aiFetch(`${API}/rag/documents/${currentTeamId}`, { headers: authHeader() });
            if (!res.ok) return;
            const data = await res.json();
            if (!isPolled) _pollAttempts = 0; // reset on manual load
            renderDocuments(data.documents);
        } catch (e) {
            console.error('Error loading documents:', e);
        }
    }

    function renderDocuments(docs) {
        if (!docs || docs.length === 0) {
            docsList.innerHTML = '';
            docsEmpty.style.display = 'block';
            return;
        }

        docsEmpty.style.display = 'none';

        const icons = { pdf: 'PDF', docx: 'DOC', txt: 'TXT', markdown: 'MD', text: 'TXT', unknown: 'FILE' };
        const canEdit = currentRole === 'owner' || currentRole === 'editor';

        docsList.innerHTML = docs.map(doc => `
            <div class="kb-doc" data-id="${doc.id}">
                <div class="kb-doc__icon kb-doc__icon--${doc.doc_type}">
                    ${icons[doc.doc_type] || icons.unknown}
                </div>
                <div class="kb-doc__info">
                    <div class="kb-doc__name" title="${escapeHtml(doc.filename)}">${escapeHtml(doc.filename)}</div>
                    <div class="kb-doc__meta">
                        <span>${formatFileSize(doc.file_size)}</span>
                        <span>•</span>
                        <span>${doc.chunk_count} chunks</span>
                        <span class="kb-doc__status kb-doc__status--${doc.status}">
                            ${getStatusIcon(doc.status)} ${doc.status}
                        </span>
                    </div>
                </div>
                <button class="kb-doc__delete ${canEdit ? '' : 'hidden'}" 
                        onclick="window._deleteDocument(${doc.id}, '${escapeHtml(doc.filename)}')" 
                        title="Delete document">DEL</button>
            </div>
        `).join('');

        // Poll for processing docs (max _MAX_POLL_ATTEMPTS to avoid infinite loop on stuck docs)
        const processing = docs.filter(d => d.status === 'pending' || d.status === 'processing');
        if (processing.length > 0 && _pollAttempts < _MAX_POLL_ATTEMPTS) {
            _pollAttempts++;
            setTimeout(() => { loadDocuments(true); loadStats(); }, 3000);
        } else if (_pollAttempts >= _MAX_POLL_ATTEMPTS) {
            _pollAttempts = 0;
            console.warn('RAG polling stopped: documents may be stuck in processing state.');
        }
    }

    window._deleteDocument = async function(docId, filename) {
        if (currentRole !== 'owner' && currentRole !== 'editor') {
            alert('Only owners and editors can delete documents.');
            return;
        }
        if (!confirm(`Delete "${filename}" from the knowledge base?`)) return;

        try {
            const res = await aiFetch(`${API}/rag/documents/${docId}`, {
                method: 'DELETE',
                headers: authHeader(),
            });
            if (res.ok) { loadDocuments(); loadStats(); }
            else {
                const err = await res.json().catch(() => ({}));
                alert(err.detail || 'Failed to delete document');
            }
        } catch (e) {
            console.error('Delete error:', e);
        }
    };

    // File upload
    // FILE UPLOAD
    if (kbUploadZone) {
        kbUploadZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            kbUploadZone.classList.add('dragover');
        });

        kbUploadZone.addEventListener('dragleave', () => {
            kbUploadZone.classList.remove('dragover');
        });

        kbUploadZone.addEventListener('drop', (e) => {
            e.preventDefault();
            kbUploadZone.classList.remove('dragover');
            if (e.dataTransfer.files.length > 0) uploadFiles(e.dataTransfer.files);
        });
    }

    if (fileInput) {
        fileInput.addEventListener('change', () => {
            if (fileInput.files.length > 0) {
                uploadFiles(fileInput.files);
                fileInput.value = '';
            }
        });
    }

    async function uploadFiles(files) {
        if (!currentTeamId) { alert('Please select a team first'); return; }
        if (currentRole !== 'owner' && currentRole !== 'editor') {
            alert('Only owners and editors can upload documents.');
            return;
        }

        const formData = new FormData();
        formData.append('team_id', currentTeamId);
        for (const file of files) formData.append('files', file);

        const origHTML = kbUploadZone.innerHTML;
        kbUploadZone.innerHTML = `
            <div class="kb-upload__icon">...</div>
            <div class="kb-upload__text">Uploading ${files.length} file(s)...</div>
        `;

        try {
            const res = await aiFetch(`${API}/rag/ingest`, {
                method: 'POST',
                headers: authHeader(),
                body: formData,
            });

            resetUploadZone();
            if (res.ok) { loadDocuments(); loadStats(); }
            else {
                const err = await res.json().catch(() => ({}));
                alert(`Upload failed: ${err.detail || 'Unknown error'}`);
            }
        } catch (e) {
            console.error('Upload error:', e);
            alert('Upload failed. Please try again.');
            resetUploadZone();
        }
    }

    function resetUploadZone() {
        kbUploadZone.innerHTML = `
            <div class="kb-upload__icon">FILE</div>
            <div class="kb-upload__text"><strong>Drop files here</strong> or browse</div>
            <div class="kb-upload__hint">PDF, DOCX, TXT, MD - up to 20MB each</div>
            <input type="file" id="kbFileInput" multiple accept=".pdf,.doc,.docx,.txt,.md">
        `;
        const newInput = document.getElementById('kbFileInput');
        newInput?.addEventListener('change', () => {
            if (newInput.files.length > 0) {
                uploadFiles(newInput.files);
                newInput.value = '';
            }
        });
    }

    // Stats
    // STATS
    async function loadStats() {
        try {
            const res = await aiFetch(`${API}/rag/stats/${currentTeamId}`, { headers: authHeader() });
            if (!res.ok) return;
            const stats = await res.json();
            statDocs.textContent = `${stats.document_count || 0} docs`;
            statChunks.textContent = `${stats.total_chunks || 0} chunks`;
        } catch (e) {
            console.error('Stats error:', e);
        }
    }

    // AI chat
    // AI CHAT (user-scoped / private)
    function showMessages() {
        chatWelcome.style.display = 'none';
        chatMessages.style.display = 'flex';
        hasMessages = true;
    }

    function showWelcome() {
        chatWelcome.style.display = 'flex';
        chatMessages.style.display = 'none';
        chatMessages.innerHTML = '';
        hasMessages = false;
    }

    async function loadChatHistory() {
        try {
            // Load sessions list first
            const sessRes = await aiFetch(`${API}/rag/chat/sessions/${currentTeamId}`, {
                headers: authHeader(),
            });
            let sessions = [];
            if (sessRes.ok) {
                const sessData = await sessRes.json();
                sessions = sessData.sessions || [];
            }

            // Render sessions panel
            renderRecentSessions(sessions);

            // If there are sessions, load the most recent one
            if (sessions.length > 0) {
                currentSessionId = sessions[0].session_id;
                await loadSessionMessages(currentSessionId);
            } else {
                currentSessionId = generateSessionId();
                showWelcome();
            }
        } catch (e) {
            console.error('Chat history error:', e);
        }
    }

    async function loadSessionMessages(sessionId) {
        try {
            const res = await aiFetch(`${API}/rag/chat/history/${currentTeamId}?limit=50&session_id=${sessionId}`, {
                headers: authHeader(),
            });
            if (!res.ok) return;
            const data = await res.json();

            if (data.messages && data.messages.length > 0) {
                showMessages();
                chatMessages.innerHTML = '';
                data.messages.forEach(msg => {
                    let sources = null;
                    if (msg.sources) {
                        try { sources = JSON.parse(msg.sources); } catch(e) {}
                    }
                    appendMessage(msg.role, msg.content, sources);
                });
                scrollToBottom();
            } else {
                showWelcome();
            }
        } catch (e) {
            console.error('Load session error:', e);
        }
    }

    // Recent chats panel
    // RECENT CHATS PANEL (Sessions-based)
    function renderRecentSessions(sessions) {
        if (!recentChatsList) return;

        if (!sessions || sessions.length === 0) {
            recentChatsList.innerHTML = '';
            recentChatsList.appendChild(recentChatsEmpty);
            recentChatsEmpty.style.display = 'flex';
            return;
        }

        recentChatsEmpty.style.display = 'none';

        // Group by date
        const groups = {};
        sessions.forEach(session => {
            const date = new Date(session.created_at);
            const today = new Date();
            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);

            let label;
            if (date.toDateString() === today.toDateString()) label = 'Today';
            else if (date.toDateString() === yesterday.toDateString()) label = 'Yesterday';
            else label = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

            if (!groups[label]) groups[label] = [];
            groups[label].push(session);
        });

        let html = '';
        for (const [label, items] of Object.entries(groups)) {
            html += `<div class="recent-chats__date-label">${label}</div>`;
            items.forEach(session => {
                const preview = session.preview.length > 45
                    ? session.preview.substring(0, 45) + '...'
                    : session.preview;
                const time = new Date(session.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                const isActive = session.session_id === currentSessionId ? ' recent-chat-item--active' : '';
                html += `
                    <div class="recent-chat-item${isActive}" data-session-id="${escapeHtml(session.session_id)}">
                        <div class="recent-chat-item__icon">AI</div>
                        <div class="recent-chat-item__info">
                            <div class="recent-chat-item__text">${escapeHtml(preview)}</div>
                            <div class="recent-chat-item__time">${time} - ${session.message_count} msgs</div>
                        </div>
                    </div>
                `;
            });
        }

        recentChatsList.innerHTML = html;
        // Re-append empty state (hidden)
        recentChatsList.appendChild(recentChatsEmpty);

        // Click handler: switch to that session
        recentChatsList.querySelectorAll('.recent-chat-item').forEach(item => {
            item.addEventListener('click', async () => {
                const sessionId = item.dataset.sessionId;
                if (sessionId === currentSessionId) return;

                currentSessionId = sessionId;

                // Update active class
                recentChatsList.querySelectorAll('.recent-chat-item').forEach(el =>
                    el.classList.remove('recent-chat-item--active'));
                item.classList.add('recent-chat-item--active');

                // Load this session's messages
                await loadSessionMessages(sessionId);
            });
        });
    }

    // Toggle recent chats panel
    if (recentChatsToggle) {
        recentChatsToggle.addEventListener('click', () => {
            recentChatsPanel.classList.toggle('collapsed');
            // Flip the chevron
            const svg = recentChatsToggle.querySelector('svg');
            if (recentChatsPanel.classList.contains('collapsed')) {
                svg.style.transform = 'rotate(180deg)';
            } else {
                svg.style.transform = 'rotate(0deg)';
            }
        });
    }

    // New Chat button - starts a fresh session without deleting from DB
    if (newChatBtn) {
        newChatBtn.addEventListener('click', () => {
            currentSessionId = generateSessionId();
            showWelcome();
            // Remove active state from all recent chat items
            if (recentChatsList) {
                recentChatsList.querySelectorAll('.recent-chat-item').forEach(el =>
                    el.classList.remove('recent-chat-item--active'));
            }
        });
    }

    async function sendMessage() {
        const message = chatInput.value.trim();
        if (!message || !currentTeamId || isTyping) return;

        showMessages();
        appendMessage('user', message);
        chatInput.value = '';
        chatInput.style.height = '44px';
        scrollToBottom();

        isTyping = true;
        chatSendBtn.disabled = true;
        showTypingIndicator();

        try {
            const res = await aiFetch(`${API}/rag/chat`, {
                method: 'POST',
                headers: jsonHeaders(),
                body: JSON.stringify({ team_id: currentTeamId, message, session_id: currentSessionId }),
            });

            hideTypingIndicator();

            if (res.ok) {
                const data = await res.json();
                appendMessage('assistant', data.response, data.sources);
            } else {
                const err = await res.json().catch(() => ({}));
                appendMessage('assistant', `[Warning] ${err.detail || 'Something went wrong. Please try again.'}`);
            }
        } catch (e) {
            hideTypingIndicator();
            appendMessage('assistant', '[Warning] Network error. Please check your connection.');
        }

        isTyping = false;
        chatSendBtn.disabled = false;
        scrollToBottom();

        // Refresh recent chats panel to include the new message
        refreshRecentChats();
    }

    async function refreshRecentChats() {
        try {
            const res = await aiFetch(`${API}/rag/chat/sessions/${currentTeamId}`, {
                headers: authHeader(),
            });
            if (!res.ok) return;
            const data = await res.json();
            renderRecentSessions(data.sessions || []);
        } catch (e) { /* silent */ }
    }

    function appendMessage(role, content, sources) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `chat-msg chat-msg--${role}`;

        const avatarContent = role === 'user' ? 'U' : 'AI';
        const avatar = `<div class="chat-msg__avatar">${avatarContent}</div>`;

        let sourcesHtml = '';
        if (sources && Array.isArray(sources) && sources.length > 0) {
            const sourceItems = sources.map(s => {
                const icon = getDocIcon(s.doc_type || 'unknown');
                const page = s.page_number > 0 ? ` (p.${s.page_number})` : '';
                return `<span class="chat-msg__source"><span class="chat-msg__source-icon">${icon}</span>${escapeHtml(s.filename)}${page}</span>`;
            }).join('');
            sourcesHtml = `
                <div class="chat-msg__sources">
                    <div class="chat-msg__sources-title">Sources Referenced</div>
                    <div class="chat-msg__source-list">${sourceItems}</div>
                </div>
            `;
        }

        let bodyHtml;
        const cardData = parseCardPayload(content);
        if (cardData) {
            bodyHtml = renderLiveCards(cardData);
        } else {
            bodyHtml = formatMarkdown(content);
        }

        if (role === 'assistant') {
            msgDiv.innerHTML = `
                <div class="chat-msg__content">
                    <div class="chat-msg__content-inner">
                        ${bodyHtml}
                        ${sourcesHtml}
                    </div>
                </div>
            `;
        } else {
            msgDiv.innerHTML = `
                <div class="chat-msg__content">
                    ${bodyHtml}
                    ${sourcesHtml}
                </div>
            `;
        }

        chatMessages.appendChild(msgDiv);
    }

    function parseCardPayload(content) {
        if (!content || typeof content !== 'string') return null;

        const marker = '__CARDS__:';
        const normalized = content.trimStart();
        const markerIndex = normalized.indexOf(marker);
        if (markerIndex < 0) return null;

        let payload = normalized.slice(markerIndex + marker.length).trim();
        if (!payload) return null;

        // Handle fenced markdown payloads: ```json ... ```
        if (payload.startsWith('```')) {
            const fenceMatch = payload.match(/^```(?:json)?\s*([\s\S]*?)\s*```/i);
            if (fenceMatch && fenceMatch[1]) {
                payload = fenceMatch[1].trim();
            }
        }

        try {
            return JSON.parse(payload);
        } catch (e) {
            // Fallback: try parsing the first JSON object in the text.
            const firstBrace = payload.indexOf('{');
            const lastBrace = payload.lastIndexOf('}');
            if (firstBrace >= 0 && lastBrace > firstBrace) {
                const candidate = payload.slice(firstBrace, lastBrace + 1);
                try {
                    return JSON.parse(candidate);
                } catch (_ignored) {
                    return null;
                }
            }
            return null;
        }
    }

    function renderLiveCards(data) {
        if (!data) return '';
        const typeEmoji = { timeline: '🕐', calendar: '📅', workspace: '📁' };
        const emoji = typeEmoji[data.type] || '📋';
        const items = data.items || [];
        const cardType = data.type || 'workspace';

        let itemsHtml = '';
        if (items.length === 0) {
            itemsHtml = '<div class="live-card__item"><span class="live-card__item-text" style="color:var(--color-text-muted)">Nothing to show right now.</span></div>';
        } else {
            items.forEach(item => {
                const title = item.title || item.name || '';
                let meta = '';
                if (data.type === 'timeline') meta = item.date || '';
                else if (data.type === 'calendar') meta = item.start || '';
                else meta = item.meta || '';
                itemsHtml += `
                    <div class="live-card__item">
                        <span class="live-card__item-dot"></span>
                        <span class="live-card__item-text">${escapeHtml(title)}</span>
                        ${meta ? `<span class="live-card__item-meta">${escapeHtml(meta)}</span>` : ''}
                    </div>
                `;
            });
        }

        return `
            <div class="live-cards">
                <div class="live-card live-card--${escapeHtml(cardType)}">
                    <div class="live-card__header">
                        <span class="live-card__icon">${emoji}</span>
                        <span class="live-card__title">${escapeHtml(data.heading || cardType)}</span>
                        <span class="live-card__badge">${items.length} items</span>
                    </div>
                    <div class="live-card__body">${itemsHtml}</div>
                </div>
            </div>
        `;
    }

    function showTypingIndicator() {
        const el = document.createElement('div');
        el.className = 'chat-typing';
        el.id = 'typingIndicator';
        el.innerHTML = `
            <div class="chat-typing__bubble">
                <div class="chat-typing__inner">
                    <div class="chat-typing__dots">
                        <span></span><span></span><span></span>
                    </div>
                    <span class="chat-typing__label">Thinking…</span>
                </div>
            </div>
        `;
        chatMessages.appendChild(el);
        scrollToBottom();
    }

    function hideTypingIndicator() {
        document.getElementById('typingIndicator')?.remove();
    }

    // Send handlers
    chatSendBtn.addEventListener('click', sendMessage);
    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });

    // Auto-resize
    chatInput.addEventListener('input', () => {
        chatInput.style.height = '44px';
        chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
    });

    // Delete chat
    // DELETE CHAT (custom modal)
    const deleteModal = document.getElementById('deleteModal');
    const deleteModalCancel = document.getElementById('deleteModalCancel');
    const deleteModalConfirm = document.getElementById('deleteModalConfirm');

    function showDeleteModal() {
        return new Promise((resolve) => {
            deleteModal.classList.add('active');

            function onConfirm() {
                cleanup();
                resolve(true);
            }
            function onCancel() {
                cleanup();
                resolve(false);
            }
            function cleanup() {
                deleteModal.classList.remove('active');
                deleteModalConfirm.removeEventListener('click', onConfirm);
                deleteModalCancel.removeEventListener('click', onCancel);
                deleteModal.removeEventListener('click', onOverlayClick);
            }
            function onOverlayClick(e) {
                if (e.target === deleteModal) onCancel();
            }

            deleteModalConfirm.addEventListener('click', onConfirm);
            deleteModalCancel.addEventListener('click', onCancel);
            deleteModal.addEventListener('click', onOverlayClick);
        });
    }

    if (deleteChatBtn) {
        deleteChatBtn.addEventListener('click', async () => {
            if (!currentTeamId) { alert('Please select a team first'); return; }

            const confirmed = await showDeleteModal();
            if (!confirmed) return;

            try {
                deleteChatBtn.disabled = true;
                const deleteUrl = `${API}/rag/chat/history/${currentTeamId}?session_id=${encodeURIComponent(currentSessionId)}`;
                const res = await aiFetch(deleteUrl, {
                    method: 'DELETE',
                    headers: authHeader(),
                });

                if (res.ok) {
                    currentSessionId = generateSessionId();
                    showWelcome();
                    refreshRecentChats();
                } else {
                    const err = await res.json().catch(() => ({}));
                    console.error('Delete failed:', err);
                    alert('Failed to delete chat. Please try again.');
                }
                deleteChatBtn.disabled = false;
            } catch (e) {
                console.error('Delete chat error:', e);
                alert('An error occurred. Please try again.');
                deleteChatBtn.disabled = false;
            }
        });
    }

    // Quick prompts
    function runQuickPrompt(promptText) {
        const prompt = (promptText || '').trim();
        if (!prompt) return;
        chatInput.value = prompt;
        sendMessage();
    }

    document.querySelectorAll('.chat-welcome__suggestion').forEach(btn => {
        btn.addEventListener('click', () => {
            const textEl = btn.querySelector('.chat-welcome__suggestion-text');
            runQuickPrompt((textEl || btn).textContent.trim());
        });
    });

    quickPromptButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            runQuickPrompt(btn.dataset.prompt || btn.textContent.trim());
        });
    });

    // Utilities
    // UTILITIES
    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function formatFileSize(bytes) {
        if (!bytes) return '0 B';
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + sizes[i];
    }

    function getStatusIcon(status) {
        return { ready: '[ok]', pending: '[...]', processing: '[...]', error: '[x]' }[status] || '[?]';
    }

    function getDocIcon(type) {
        return { pdf: 'PDF', docx: 'DOC', txt: 'TXT', markdown: 'MD', text: 'TXT' }[type] || 'FILE';
    }

    /* ── Inline formatter (bold, italic, inline code) ── */
    function inlineFormat(text) {
        return text
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.+?)\*/g, '<em>$1</em>')
            .replace(/_(.+?)_/g, '<em>$1</em>');
    }

    function escapeHtml(s) {
        return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    /* ── Full block-level markdown parser ── */
    function formatMarkdown(text) {
        if (!text) return '';

        // Pull out fenced code blocks first so nothing inside gets mangled
        const codeBlocks = [];
        text = text.replace(/```(\w+)?\n?([\s\S]*?)```/g, (_, _lang, code) => {
            codeBlocks.push(`<pre><code>${escapeHtml(code.trim())}</code></pre>`);
            return `\x00CODE${codeBlocks.length - 1}\x00`;
        });

        const lines = text.split('\n');
        const out = [];
        let inUL = false, inOL = false, inBQ = false;
        let para = [];

        function flushPara() {
            if (para.length) { out.push(`<p>${inlineFormat(para.join(' '))}</p>`); para = []; }
        }
        function closeList() {
            if (inUL) { out.push('</ul>'); inUL = false; }
            if (inOL) { out.push('</ol>'); inOL = false; }
        }
        function closeBQ() {
            if (inBQ) { out.push('</blockquote>'); inBQ = false; }
        }

        for (const line of lines) {
            // Code block placeholder
            if (line.includes('\x00CODE')) {
                flushPara(); closeList(); closeBQ();
                out.push(line.replace(/\x00CODE(\d+)\x00/g, (_, i) => codeBlocks[+i]));
                continue;
            }

            // Headings
            const h3m = line.match(/^### (.+)$/);
            const h2m = line.match(/^## (.+)$/);
            const h1m = line.match(/^# (.+)$/);
            if (h3m || h2m || h1m) {
                flushPara(); closeList(); closeBQ();
                const tag = h3m ? 'h3' : h2m ? 'h2' : 'h1';
                out.push(`<${tag}>${inlineFormat((h3m||h2m||h1m)[1])}</${tag}>`);
                continue;
            }

            // Horizontal rule
            if (/^[-*]{3,}$/.test(line.trim())) {
                flushPara(); closeList(); closeBQ();
                out.push('<hr>');
                continue;
            }

            // Blockquote
            const bqm = line.match(/^> (.+)$/);
            if (bqm) {
                flushPara(); closeList();
                if (!inBQ) { out.push('<blockquote>'); inBQ = true; }
                out.push(`<p>${inlineFormat(bqm[1])}</p>`);
                continue;
            } else { closeBQ(); }

            // Unordered list
            const ulm = line.match(/^[-*\u2022] (.+)$/);
            if (ulm) {
                flushPara();
                if (inOL) { out.push('</ol>'); inOL = false; }
                if (!inUL) { out.push('<ul>'); inUL = true; }
                out.push(`<li>${inlineFormat(ulm[1])}</li>`);
                continue;
            }

            // Ordered list
            const olm = line.match(/^\d+\. (.+)$/);
            if (olm) {
                flushPara();
                if (inUL) { out.push('</ul>'); inUL = false; }
                if (!inOL) { out.push('<ol>'); inOL = true; }
                out.push(`<li>${inlineFormat(olm[1])}</li>`);
                continue;
            }

            // Empty line — close everything and break paragraph
            if (line.trim() === '') {
                flushPara(); closeList(); closeBQ();
                continue;
            }

            // Regular text line
            closeList();
            para.push(line);
        }

        flushPara(); closeList(); closeBQ();
        return out.join('\n');
    }

    function scrollToBottom() {
        requestAnimationFrame(() => {
            chatMessages.scrollTop = chatMessages.scrollHeight;
        });
    }

    // Init
    loadTeams();
});
