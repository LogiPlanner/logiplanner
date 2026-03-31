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
    const clearHistoryBtn = document.getElementById('clearHistoryBtn');
    const chatModeBtn = document.getElementById('chatModeBtn');
    const studioModeBtn = document.getElementById('studioModeBtn');
    const modeToggle = document.getElementById('modeToggle');
    const kbUploadZone = document.getElementById('kbUploadZone');
    const fileInput = document.getElementById('kbFileInput');
    const docsList = document.getElementById('kbDocsList');
    const docsEmpty = document.getElementById('kbDocsEmpty');
    const statDocs = document.getElementById('statDocs');
    const statChunks = document.getElementById('statChunks');

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
            const res = await fetch(`${API}/rag/chat/history/${currentTeamId}?limit=50`, {
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
            console.error('Chat history error:', e);
        }
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
                body: JSON.stringify({ team_id: currentTeamId, message }),
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

        msgDiv.innerHTML = `
            ${avatar}
            <div class="chat-msg__content">
                ${formatMarkdown(content)}
                ${sourcesHtml}
            </div>
        `;

        chatMessages.appendChild(msgDiv);
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
    // CLEAR HISTORY (custom modal, no native confirm)
    // ─────────────────────────────────────────
    const clearModal = document.getElementById('clearModal');
    const clearModalCancel = document.getElementById('clearModalCancel');
    const clearModalConfirm = document.getElementById('clearModalConfirm');

    function showClearModal() {
        return new Promise((resolve) => {
            clearModal.classList.add('active');

            function onConfirm() {
                cleanup();
                resolve(true);
            }
            function onCancel() {
                cleanup();
                resolve(false);
            }
            function cleanup() {
                clearModal.classList.remove('active');
                clearModalConfirm.removeEventListener('click', onConfirm);
                clearModalCancel.removeEventListener('click', onCancel);
                clearModal.removeEventListener('click', onOverlayClick);
            }
            function onOverlayClick(e) {
                if (e.target === clearModal) onCancel();
            }

            clearModalConfirm.addEventListener('click', onConfirm);
            clearModalCancel.addEventListener('click', onCancel);
            clearModal.addEventListener('click', onOverlayClick);
        });
    }

    if (clearHistoryBtn) {
        clearHistoryBtn.addEventListener('click', async () => {
            if (!currentTeamId) { alert('Please select a team first'); return; }

            const confirmed = await showClearModal();
            if (!confirmed) return;

            try {
                clearHistoryBtn.disabled = true;
                const res = await fetch(`${API}/rag/chat/history/${currentTeamId}`, {
                    method: 'DELETE',
                    headers: authHeader(),
                });

                if (res.ok) {
                    showWelcome();
                } else {
                    const err = await res.json().catch(() => ({}));
                    console.error('Clear failed:', err);
                    alert('Failed to clear history. Please try again.');
                }
                clearHistoryBtn.disabled = false;
            } catch (e) {
                console.error('Clear history error:', e);
                alert('An error occurred. Please try again.');
                clearHistoryBtn.disabled = false;
            }
        });
    }

    // Quick prompts
    document.querySelectorAll('.chat-welcome__suggestion').forEach(btn => {
        btn.addEventListener('click', () => {
            chatInput.value = btn.textContent.trim();
            sendMessage();
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
