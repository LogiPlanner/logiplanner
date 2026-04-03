/**
 * AI Brain v2 — Frontend Logic
 * =============================
 * - Chat Mode / Studio Mode toggle
 * - User-scoped private chat (NOT team chat)
 * - RBAC: owner/editor can manage KB, viewer can only chat
 * - Mobile responsive sidebar
 */

document.addEventListener('DOMContentLoaded', () => {
    // ── Auth Guard ──
    const token = localStorage.getItem('access_token');
    if (!token) { window.location.href = '/login'; return; }

    const API = '/api/v1';
    const authHeader = () => ({ 'Authorization': `Bearer ${token}` });
    const jsonHeaders = () => ({
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
    });

    // ── State ──
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

    // ── DOM ──
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
    const chatModeBtn = document.getElementById('chatModeBtn');
    const studioModeBtn = document.getElementById('studioModeBtn');
    const modeToggle = document.getElementById('modeToggle');
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

    // ─────────────────────────────────────────
    // MOBILE SIDEBAR
    // ─────────────────────────────────────────
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

    // ─────────────────────────────────────────
    // LOGOUT
    // ─────────────────────────────────────────
    document.getElementById('logoutBtn')?.addEventListener('click', () => {
        localStorage.removeItem('access_token');
        window.location.href = '/login';
    });

    // ─────────────────────────────────────────
    // TEAM LOADING & ROLE
    // ─────────────────────────────────────────
    async function loadTeams() {
        try {
            const res = await fetch(`${API}/onboarding/my-teams`, { headers: authHeader() });
            if (!res.ok) return;
            const data = await res.json();

            if (data.teams && data.teams.length > 0) {
                teamSelect.innerHTML = '';
                data.teams.forEach(t => {
                    const opt = document.createElement('option');
                    opt.value = t.id;
                    opt.textContent = t.team_name;
                    opt.dataset.role = t.role || 'viewer';
                    teamSelect.appendChild(opt);
                });
                currentTeamId = data.teams[0].id;
                currentRole = data.teams[0].role || 'viewer';
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
        applyRole();
        loadAll();
    });

    function applyRole() {
        // Update badge
        roleBadge.textContent = currentRole;
        roleBadge.className = `role-badge role-badge--${currentRole}`;

        // Studio mode: only owner/editor
        const canEdit = currentRole === 'owner' || currentRole === 'editor';

        if (studioModeBtn) {
            if (canEdit) {
                studioModeBtn.classList.remove('disabled');
                studioModeBtn.title = 'Knowledge Base + Chat';
            } else {
                studioModeBtn.classList.add('disabled');
                studioModeBtn.title = 'Only owners and editors can access Studio Mode';
                // Force chat mode if viewer
                if (currentMode === 'studio') {
                    switchMode('chat');
                }
            }
        }

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

    // ─────────────────────────────────────────
    // MODE TOGGLE
    // ─────────────────────────────────────────
    function switchMode(mode) {
        currentMode = mode;
        brainContent.classList.remove('mode-chat', 'mode-studio');
        brainContent.classList.add(`mode-${mode}`);

        chatModeBtn.classList.toggle('active', mode === 'chat');
        studioModeBtn.classList.toggle('active', mode === 'studio');
    }

    chatModeBtn?.addEventListener('click', () => switchMode('chat'));

    studioModeBtn?.addEventListener('click', () => {
        const canEdit = currentRole === 'owner' || currentRole === 'editor';
        if (!canEdit) return;
        switchMode('studio');
    });

    // ─────────────────────────────────────────
    // KNOWLEDGE BASE: DOCUMENTS
    // ─────────────────────────────────────────
    async function loadDocuments() {
        try {
            const res = await fetch(`${API}/rag/documents/${currentTeamId}`, { headers: authHeader() });
            if (!res.ok) return;
            const data = await res.json();
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

        const icons = { pdf: '📕', docx: '📘', txt: '📄', markdown: '📝', text: '✏️', unknown: '📎' };
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
                        title="Delete document">🗑️</button>
            </div>
        `).join('');

        // Poll for processing docs
        const processing = docs.filter(d => d.status === 'pending' || d.status === 'processing');
        if (processing.length > 0) {
            setTimeout(() => { loadDocuments(); loadStats(); }, 3000);
        }
    }

    window._deleteDocument = async function(docId, filename) {
        if (currentRole !== 'owner' && currentRole !== 'editor') {
            alert('Only owners and editors can delete documents.');
            return;
        }
        if (!confirm(`Delete "${filename}" from the knowledge base?`)) return;

        try {
            const res = await fetch(`${API}/rag/documents/${docId}`, {
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

    // ─────────────────────────────────────────
    // FILE UPLOAD
    // ─────────────────────────────────────────
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
            <div class="kb-upload__icon">⏳</div>
            <div class="kb-upload__text">Uploading ${files.length} file(s)...</div>
        `;

        try {
            const res = await fetch(`${API}/rag/ingest`, {
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
            <div class="kb-upload__icon">📄</div>
            <div class="kb-upload__text"><strong>Drop files here</strong> or browse</div>
            <div class="kb-upload__hint">PDF, DOCX, TXT, MD — up to 20MB each</div>
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

    // ─────────────────────────────────────────
    // STATS
    // ─────────────────────────────────────────
    async function loadStats() {
        try {
            const res = await fetch(`${API}/rag/stats/${currentTeamId}`, { headers: authHeader() });
            if (!res.ok) return;
            const stats = await res.json();
            statDocs.textContent = `${stats.document_count || 0} docs`;
            statChunks.textContent = `${stats.total_chunks || 0} chunks`;
        } catch (e) {
            console.error('Stats error:', e);
        }
    }

    // ─────────────────────────────────────────
    // AI CHAT (user-scoped / private)
    // ─────────────────────────────────────────
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
            const sessRes = await fetch(`${API}/rag/chat/sessions/${currentTeamId}`, {
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
            const res = await fetch(`${API}/rag/chat/history/${currentTeamId}?limit=50&session_id=${sessionId}`, {
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

    // ─────────────────────────────────────────
    // RECENT CHATS PANEL (Sessions-based)
    // ─────────────────────────────────────────
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
                    ? session.preview.substring(0, 45) + '…'
                    : session.preview;
                const time = new Date(session.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                const isActive = session.session_id === currentSessionId ? ' recent-chat-item--active' : '';
                html += `
                    <div class="recent-chat-item${isActive}" data-session-id="${escapeHtml(session.session_id)}">
                        <div class="recent-chat-item__icon">💬</div>
                        <div class="recent-chat-item__info">
                            <div class="recent-chat-item__text">${escapeHtml(preview)}</div>
                            <div class="recent-chat-item__time">${time} · ${session.message_count} msgs</div>
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

    // New Chat button — starts a fresh session without deleting from DB
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
            const res = await fetch(`${API}/rag/chat`, {
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
                appendMessage('assistant', `⚠️ ${err.detail || 'Something went wrong. Please try again.'}`);
            }
        } catch (e) {
            hideTypingIndicator();
            appendMessage('assistant', '⚠️ Network error. Please check your connection.');
        }

        isTyping = false;
        chatSendBtn.disabled = false;
        scrollToBottom();

        // Refresh recent chats panel to include the new message
        refreshRecentChats();
    }

    async function refreshRecentChats() {
        try {
            const res = await fetch(`${API}/rag/chat/sessions/${currentTeamId}`, {
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

        const avatarContent = role === 'user' ? 'U' : '🧠';
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
                    <div class="chat-msg__sources-title">📚 Sources Referenced</div>
                    ${sourceItems}
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

        msgDiv.innerHTML = `
            ${avatar}
            <div class="chat-msg__content">
                ${bodyHtml}
                ${sourcesHtml}
            </div>
        `;

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
        const typeIcons = { timeline: '🕐', calendar: '📅', workspace: '🗂️' };
        const icon = typeIcons[data.type] || '📋';
        const items = data.items || [];

        let html = `
            <div class="live-cards">
                <div class="live-cards__heading">
                    <span>${icon}</span>
                    <span>${escapeHtml(data.heading || '')}</span>
                    <a href="${escapeHtml(data.url || '#')}" class="live-cards__view-all">View All →</a>
                </div>
        `;

        if (items.length === 0) {
            html += `<div class="live-cards__empty">Nothing to show right now.</div>`;
        } else if (data.type === 'timeline') {
            const typeMeta = {
                decision:  { label: 'Decision',  cls: 'decision',  ico: '⚖️'  },
                milestone: { label: 'Milestone', cls: 'milestone', ico: '🏆' },
                summary:   { label: 'Summary',   cls: 'summary',   ico: '📋' },
                upload:    { label: 'Upload',     cls: 'upload',    ico: '📎' },
            };
            items.forEach(item => {
                const t = typeMeta[item.entry_type] || { label: item.entry_type, cls: 'default', ico: '📌' };
                html += `
                    <div class="live-card live-card--${t.cls}">
                        <div class="live-card__accent"></div>
                        <div class="live-card__body">
                            <div class="live-card__row-top">
                                <span class="live-card__type-badge live-card__type-badge--${t.cls}">${t.ico} ${t.label}</span>
                                <span class="live-card__meta-date">${escapeHtml(item.date || '')}</span>
                            </div>
                            <div class="live-card__title">${escapeHtml(item.title || '')}</div>
                            <div class="live-card__project">📁 ${escapeHtml(item.project || '')}</div>
                            ${item.content ? `<div class="live-card__desc">${escapeHtml(item.content)}</div>` : ''}
                        </div>
                        <a href="${escapeHtml(data.url || '/memory')}" class="live-card__open-btn">Open →</a>
                    </div>
                `;
            });
        } else if (data.type === 'calendar') {
            items.forEach(item => {
                const pCls = item.priority === 'high' ? 'high' : item.priority === 'low' ? 'low' : 'medium';
                html += `
                    <div class="live-card live-card--task">
                        <div class="live-card__accent"></div>
                        <div class="live-card__body">
                            <div class="live-card__row-top">
                                <span class="live-card__priority-badge live-card__priority-badge--${pCls}">${escapeHtml(item.priority || 'medium')}</span>
                            </div>
                            <div class="live-card__title">${escapeHtml(item.title || '')}</div>
                            <div class="live-card__meta-date">📅 ${escapeHtml(item.start)} → ${escapeHtml(item.end)}</div>
                            ${item.location ? `<div class="live-card__project">📍 ${escapeHtml(item.location)}</div>` : ''}
                        </div>
                        <a href="${escapeHtml(data.url || '/dashboard')}" class="live-card__open-btn">Open →</a>
                    </div>
                `;
            });
        } else {
            items.forEach(item => {
                html += `
                    <div class="live-card live-card--task">
                        <div class="live-card__accent"></div>
                        <div class="live-card__body">
                            <div class="live-card__row-top">
                                ${item.badge ? `<span class="live-card__type-badge live-card__type-badge--summary">${escapeHtml(item.badge)}</span>` : ''}
                                ${item.meta ? `<span class="live-card__meta-date">${escapeHtml(item.meta)}</span>` : ''}
                            </div>
                            <div class="live-card__title">${escapeHtml(item.title || '')}</div>
                            ${item.secondary ? `<div class="live-card__project">${escapeHtml(item.secondary)}</div>` : ''}
                            ${item.description ? `<div class="live-card__desc">${escapeHtml(item.description)}</div>` : ''}
                        </div>
                        <a href="${escapeHtml(item.href || data.url || '/dashboard')}" class="live-card__open-btn">${escapeHtml(item.cta || 'Open →')}</a>
                    </div>
                `;
            });
        }

        html += `</div>`;
        return html;
    }

    function showTypingIndicator() {
        const el = document.createElement('div');
        el.className = 'chat-typing';
        el.id = 'typingIndicator';
        el.innerHTML = `
            <div class="chat-typing__avatar">🧠</div>
            <div class="chat-typing__dots">
                <div class="chat-typing__dot"></div>
                <div class="chat-typing__dot"></div>
                <div class="chat-typing__dot"></div>
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

    // ─────────────────────────────────────────
    // DELETE CHAT (custom modal)
    // ─────────────────────────────────────────
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
                const res = await fetch(deleteUrl, {
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
            runQuickPrompt(btn.textContent.trim());
        });
    });

    quickPromptButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            runQuickPrompt(btn.dataset.prompt || btn.textContent.trim());
        });
    });

    // ─────────────────────────────────────────
    // UTILITIES
    // ─────────────────────────────────────────
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
        return { ready: '✅', pending: '⏳', processing: '⚙️', error: '❌' }[status] || '❓';
    }

    function getDocIcon(type) {
        return { pdf: '📕', docx: '📘', txt: '📄', markdown: '📝', text: '✏️' }[type] || '📎';
    }

    function formatMarkdown(text) {
        if (!text) return '';
        let html = text
            .replace(/```(\w+)?\n?([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.+?)\*/g, '<em>$1</em>')
            .replace(/^### (.+)$/gm, '<strong style="font-size:0.92rem;">$1</strong>')
            .replace(/^## (.+)$/gm, '<strong style="font-size:0.98rem;">$1</strong>')
            .replace(/^[-•] (.+)$/gm, '<li>$1</li>')
            .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
            .replace(/\n\n/g, '</p><p>')
            .replace(/\n/g, '<br>');

        html = html.replace(/(<li>.*?<\/li>(?:\s*<br>\s*<li>.*?<\/li>)*)/g, '<ul>$1</ul>');
        html = html.replace(/<br><li>/g, '<li>');

        return `<p>${html}</p>`;
    }

    function scrollToBottom() {
        requestAnimationFrame(() => {
            chatMessages.scrollTop = chatMessages.scrollHeight;
        });
    }

    // ─── Init ───
    loadTeams();
});
