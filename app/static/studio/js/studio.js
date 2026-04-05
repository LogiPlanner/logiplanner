/**
 * Knowledge Space (Studio) — Frontend Logic
 * ==========================================
 * - Team-scoped document management
 * - File upload with drag-drop + progress
 * - Text ingestion
 * - URL ingestion
 * - Document library with search, filter, grid/list
 * - RBAC: owner/editor can ingest; viewer can browse
 */

document.addEventListener('DOMContentLoaded', () => {
    // ── Auth Guard ──
    let token = localStorage.getItem('access_token');
    if (!token) { window.location.href = '/login'; return; }

    const API = '/api/v1';
    const authHeader = () => ({ 'Authorization': `Bearer ${localStorage.getItem('access_token')}` });
    const jsonHeaders = () => ({
        'Authorization': `Bearer ${localStorage.getItem('access_token')}`,
        'Content-Type': 'application/json',
    });

    // Use the shared authFetch from common.js (handles token refresh + logout)
    const sFetch = (url, opts = {}) => window.__lp.authFetch(url, opts);

    // ── State ──
    let currentTeamId = null;
    let currentRole = 'viewer';
    let allDocuments = [];
    let viewMode = 'grid'; // 'grid' or 'list'
    let pendingDeleteId = null;
    let pendingDeleteName = '';

    // ── DOM ──
    const studioMain = document.querySelector('.studio-main');
    const teamSelect = document.getElementById('teamSelect');
    const roleBadge = document.getElementById('roleBadge');

    // Stats
    const statDocs = document.getElementById('statDocs');
    const statChunks = document.getElementById('statChunks');
    const statTypes = document.getElementById('statTypes');
    const statReady = document.getElementById('statReady');

    // Upload
    const uploadZone = document.getElementById('uploadZone');
    const fileInput = document.getElementById('fileInput');
    const uploadProgress = document.getElementById('uploadProgress');

    // Text ingest
    const textTitle = document.getElementById('textTitle');
    const textContent = document.getElementById('textContent');
    const textIngestBtn = document.getElementById('textIngestBtn');

    // URL ingest
    const urlInput = document.getElementById('urlInput');
    const urlIngestBtn = document.getElementById('urlIngestBtn');

    // Document library
    const docSearch = document.getElementById('docSearch');
    const filterType = document.getElementById('filterType');
    const filterStatus = document.getElementById('filterStatus');
    const docContainer = document.getElementById('docContainer');
    const docEmpty = document.getElementById('docEmpty');
    const docCountBadge = document.getElementById('docCountBadge');
    const viewGrid = document.getElementById('viewGrid');
    const viewList = document.getElementById('viewList');

    // Delete modal
    const deleteModal = document.getElementById('deleteModal');
    const deleteModalDesc = document.getElementById('deleteModalDesc');
    const deleteModalCancel = document.getElementById('deleteModalCancel');
    const deleteModalConfirm = document.getElementById('deleteModalConfirm');

    // Drawer
    const docDrawer = document.getElementById('docDrawer');
    const docDrawerOverlay = document.getElementById('docDrawerOverlay');
    const drawerDocName = document.getElementById('drawerDocName');
    const drawerMeta = document.getElementById('drawerMeta');
    const drawerClose = document.getElementById('drawerClose');

    // Toast container
    const toastContainer = document.createElement('div');
    toastContainer.className = 'toast-container';
    document.body.appendChild(toastContainer);

    // ─────────────────────────────────────────
    // TOAST NOTIFICATIONS
    // ─────────────────────────────────────────
    function showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast toast--${type}`;
        const icons = { success: '✅', error: '❌', info: 'ℹ️' };
        toast.innerHTML = `<span>${icons[type] || ''}</span><span>${escapeHtml(message)}</span>`;
        toastContainer.appendChild(toast);
        setTimeout(() => {
            toast.style.animation = 'toastOut 0.3s ease forwards';
            setTimeout(() => toast.remove(), 300);
        }, 3500);
    }

    // ─────────────────────────────────────────
    // TEAM LOADING & ROLE
    // ─────────────────────────────────────────
    async function loadTeams() {
        try {
            const res = await sFetch(`${API}/onboarding/my-teams`, { headers: authHeader() });
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
        roleBadge.textContent = currentRole;
        roleBadge.className = `role-badge role-badge--${currentRole}`;

        const canEdit = currentRole === 'owner' || currentRole === 'editor';
        studioMain.classList.toggle('viewer-mode', !canEdit);
    }

    function loadAll() {
        if (!currentTeamId) return;
        loadDocuments();
        loadStats();
    }

    // ─────────────────────────────────────────
    // STATS
    // ─────────────────────────────────────────
    async function loadStats() {
        try {
            const res = await sFetch(`${API}/rag/stats/${currentTeamId}`, { headers: authHeader() });
            if (!res.ok) return;
            const stats = await res.json();

            animateNumber(statDocs, stats.document_count || 0);
            animateNumber(statChunks, stats.total_chunks || 0);

            // Count unique types and ready docs from current docs
            const types = new Set((stats.doc_types || []).map(t => t));
            animateNumber(statTypes, types.size || 0);

            // Ready count from documents
            const readyCount = allDocuments.filter(d => d.status === 'ready').length;
            animateNumber(statReady, readyCount);
        } catch (e) {
            console.error('Stats error:', e);
        }
    }

    function animateNumber(el, target) {
        const current = parseInt(el.textContent) || 0;
        if (current === target) return;

        const duration = 400;
        const start = performance.now();

        function step(timestamp) {
            const elapsed = timestamp - start;
            const progress = Math.min(elapsed / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            el.textContent = Math.round(current + (target - current) * eased);
            if (progress < 1) requestAnimationFrame(step);
        }

        requestAnimationFrame(step);
    }

    // ─────────────────────────────────────────
    // DOCUMENT LOADING
    // ─────────────────────────────────────────
    async function loadDocuments() {
        try {
            const res = await sFetch(`${API}/rag/documents/${currentTeamId}`, { headers: authHeader() });
            if (!res.ok) return;
            const data = await res.json();
            allDocuments = data.documents || [];
            renderDocuments();
            updateReadyCount();

            // Poll for processing docs
            const processing = allDocuments.filter(d => d.status === 'pending' || d.status === 'processing');
            if (processing.length > 0) {
                setTimeout(() => { loadDocuments(); loadStats(); }, 3000);
            }
        } catch (e) {
            console.error('Error loading documents:', e);
        }
    }

    function updateReadyCount() {
        const readyCount = allDocuments.filter(d => d.status === 'ready').length;
        animateNumber(statReady, readyCount);
    }

    function getFilteredDocs() {
        let docs = [...allDocuments];
        const search = (docSearch.value || '').toLowerCase().trim();
        const typeFilter = filterType.value;
        const statusFilter = filterStatus.value;

        if (search) {
            docs = docs.filter(d =>
                d.filename.toLowerCase().includes(search) ||
                (d.uploader_email || '').toLowerCase().includes(search)
            );
        }

        if (typeFilter) {
            docs = docs.filter(d => d.doc_type === typeFilter);
        }

        if (statusFilter) {
            docs = docs.filter(d => d.status === statusFilter);
        }

        return docs;
    }

    function renderDocuments() {
        const docs = getFilteredDocs();
        docCountBadge.textContent = `${docs.length} document${docs.length !== 1 ? 's' : ''}`;

        if (docs.length === 0) {
            docContainer.innerHTML = '';
            docEmpty.style.display = 'block';
            if (allDocuments.length > 0 && docs.length === 0) {
                docEmpty.querySelector('.doc-empty__title').textContent = 'No matching documents';
                docEmpty.querySelector('.doc-empty__text').textContent = 'Try adjusting your search or filters.';
            } else {
                docEmpty.querySelector('.doc-empty__title').textContent = 'No documents yet';
                docEmpty.querySelector('.doc-empty__text').textContent = 'Upload files, paste text, or ingest URLs above to start building your knowledge base.';
            }
            return;
        }

        docEmpty.style.display = 'none';

        const icons = {
            pdf: '📕', docx: '📘', txt: '📄', markdown: '📝',
            text: '✏️', unknown: '📎'
        };

        const statusIcons = {
            ready: '✅', pending: '⏳', processing: '⚙️', error: '❌'
        };

        const canEdit = currentRole === 'owner' || currentRole === 'editor';

        docContainer.innerHTML = docs.map(doc => {
            const icon = icons[doc.doc_type] || icons.unknown;
            const statusIcon = statusIcons[doc.status] || '❓';
            const size = formatFileSize(doc.file_size);
            const date = doc.created_at ? formatDate(doc.created_at) : '';
            const uploader = doc.uploader_email ? doc.uploader_email.split('@')[0] : '';

            return `
                <div class="doc-card" data-id="${doc.id}" onclick="window._openDocDrawer(${doc.id})">
                    <div class="doc-card__accent doc-card__accent--${doc.doc_type || 'unknown'}"></div>
                    ${canEdit ? `
                        <div class="doc-card__actions">
                            <button class="doc-card__action-btn" onclick="event.stopPropagation(); window._confirmDelete(${doc.id}, '${escapeHtml(doc.filename)}')" title="Delete document">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                            </button>
                        </div>
                    ` : ''}
                    <div class="doc-card__top">
                        <div class="doc-card__icon doc-card__icon--${doc.doc_type || 'unknown'}">${icon}</div>
                        <div class="doc-card__name">
                            <h4 title="${escapeHtml(doc.filename)}">${escapeHtml(doc.filename)}</h4>
                            <div class="doc-card__type">${doc.doc_type || 'unknown'}</div>
                        </div>
                        <span class="doc-card__status doc-card__status--${doc.status}">${statusIcon} ${doc.status}</span>
                    </div>
                    <div class="doc-card__meta">
                        <span class="doc-card__meta-item">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 7v10c0 2 3.6 4 8 4s8-1.8 8-4V7"/></svg>
                            ${doc.chunk_count} chunks
                        </span>
                        <span class="doc-card__meta-item">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/></svg>
                            ${size}
                        </span>
                        ${date ? `
                            <span class="doc-card__meta-item">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
                                ${date}
                            </span>
                        ` : ''}
                        ${uploader ? `
                            <span class="doc-card__meta-item">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>
                                ${escapeHtml(uploader)}
                            </span>
                        ` : ''}
                    </div>
                </div>
            `;
        }).join('');
    }

    // ─────────────────────────────────────────
    // SEARCH & FILTERS
    // ─────────────────────────────────────────
    let searchDebounce;
    docSearch.addEventListener('input', () => {
        clearTimeout(searchDebounce);
        searchDebounce = setTimeout(renderDocuments, 250);
    });

    filterType.addEventListener('change', renderDocuments);
    filterStatus.addEventListener('change', renderDocuments);

    // ─────────────────────────────────────────
    // VIEW TOGGLE
    // ─────────────────────────────────────────
    viewGrid.addEventListener('click', () => {
        viewMode = 'grid';
        docContainer.className = 'doc-container doc-container--grid';
        viewGrid.classList.add('active');
        viewList.classList.remove('active');
    });

    viewList.addEventListener('click', () => {
        viewMode = 'list';
        docContainer.className = 'doc-container doc-container--list';
        viewList.classList.add('active');
        viewGrid.classList.remove('active');
    });

    // ─────────────────────────────────────────
    // FILE UPLOAD
    // ─────────────────────────────────────────
    if (uploadZone) {
        uploadZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadZone.classList.add('dragover');
        });

        uploadZone.addEventListener('dragleave', () => {
            uploadZone.classList.remove('dragover');
        });

        uploadZone.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadZone.classList.remove('dragover');
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
        if (!currentTeamId) { showToast('Please select a team first', 'error'); return; }
        if (currentRole !== 'owner' && currentRole !== 'editor') {
            showToast('Only owners and editors can upload documents', 'error');
            return;
        }

        // Show progress items
        uploadProgress.innerHTML = '';
        for (const file of files) {
            const item = document.createElement('div');
            item.className = 'upload-progress-item';
            item.innerHTML = `
                <span class="upload-progress-item__name">${escapeHtml(file.name)}</span>
                <span class="upload-progress-item__status upload-progress-item__status--uploading">Uploading...</span>
            `;
            uploadProgress.appendChild(item);
        }

        const formData = new FormData();
        formData.append('team_id', currentTeamId);
        for (const file of files) formData.append('files', file);

        try {
            const res = await sFetch(`${API}/rag/ingest`, {
                method: 'POST',
                headers: authHeader(),
                body: formData,
            });

            if (res.ok) {
                const data = await res.json();
                // Update progress items to done
                uploadProgress.querySelectorAll('.upload-progress-item__status').forEach(el => {
                    el.className = 'upload-progress-item__status upload-progress-item__status--done';
                    el.textContent = 'Queued';
                });
                showToast(`${files.length} file(s) queued for processing`, 'success');
                setTimeout(() => { uploadProgress.innerHTML = ''; }, 2000);
                loadDocuments();
                loadStats();
            } else {
                const err = await res.json().catch(() => ({}));
                uploadProgress.querySelectorAll('.upload-progress-item__status').forEach(el => {
                    el.className = 'upload-progress-item__status upload-progress-item__status--error';
                    el.textContent = 'Failed';
                });
                showToast(err.detail || 'Upload failed', 'error');
            }
        } catch (e) {
            showToast('Upload failed. Please try again.', 'error');
            uploadProgress.innerHTML = '';
        }
    }

    // ─────────────────────────────────────────
    // TEXT INGESTION
    // ─────────────────────────────────────────
    textIngestBtn.addEventListener('click', async () => {
        const title = textTitle.value.trim();
        const content = textContent.value.trim();

        if (!title) { showToast('Please enter a title', 'error'); return; }
        if (!content) { showToast('Please enter some text content', 'error'); return; }
        if (!currentTeamId) { showToast('Please select a team first', 'error'); return; }

        textIngestBtn.disabled = true;
        textIngestBtn.textContent = 'Ingesting...';

        try {
            const res = await sFetch(`${API}/rag/ingest-text`, {
                method: 'POST',
                headers: jsonHeaders(),
                body: JSON.stringify({ team_id: currentTeamId, title, content }),
            });

            if (res.ok) {
                showToast(`"${title}" ingested successfully`, 'success');
                textTitle.value = '';
                textContent.value = '';
                loadDocuments();
                loadStats();
            } else {
                const err = await res.json().catch(() => ({}));
                showToast(err.detail || 'Text ingestion failed', 'error');
            }
        } catch (e) {
            showToast('Text ingestion failed', 'error');
        }

        textIngestBtn.disabled = false;
        textIngestBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg>
            Ingest Text
        `;
    });

    // ─────────────────────────────────────────
    // URL INGESTION
    // ─────────────────────────────────────────
    urlIngestBtn.addEventListener('click', async () => {
        const url = urlInput.value.trim();

        if (!url) { showToast('Please enter a URL', 'error'); return; }
        if (!currentTeamId) { showToast('Please select a team first', 'error'); return; }

        // Basic URL validation
        try { new URL(url); } catch {
            showToast('Please enter a valid URL', 'error');
            return;
        }

        urlIngestBtn.disabled = true;
        urlIngestBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
            Fetching...
        `;

        try {
            const res = await sFetch(`${API}/rag/ingest-url`, {
                method: 'POST',
                headers: jsonHeaders(),
                body: JSON.stringify({ team_id: currentTeamId, url }),
            });

            if (res.ok) {
                showToast('URL content ingested successfully', 'success');
                urlInput.value = '';
                loadDocuments();
                loadStats();
            } else {
                const err = await res.json().catch(() => ({}));
                showToast(err.detail || 'URL ingestion failed', 'error');
            }
        } catch (e) {
            showToast('URL ingestion failed', 'error');
        }

        urlIngestBtn.disabled = false;
        urlIngestBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
            Fetch & Ingest
        `;
    });

    // ─────────────────────────────────────────
    // DELETE DOCUMENT
    // ─────────────────────────────────────────
    window._confirmDelete = function(docId, filename) {
        pendingDeleteId = docId;
        pendingDeleteName = filename;
        deleteModalDesc.textContent = `This will permanently delete "${filename}" and remove all its chunks from the knowledge base.`;
        deleteModal.classList.add('active');
    };

    deleteModalCancel.addEventListener('click', () => {
        deleteModal.classList.remove('active');
        pendingDeleteId = null;
    });

    deleteModal.addEventListener('click', (e) => {
        if (e.target === deleteModal) {
            deleteModal.classList.remove('active');
            pendingDeleteId = null;
        }
    });

    deleteModalConfirm.addEventListener('click', async () => {
        if (!pendingDeleteId) return;

        deleteModalConfirm.disabled = true;
        deleteModalConfirm.textContent = 'Deleting...';

        try {
            const res = await sFetch(`${API}/rag/documents/${pendingDeleteId}`, {
                method: 'DELETE',
                headers: authHeader(),
            });

            if (res.ok) {
                showToast(`"${pendingDeleteName}" deleted`, 'success');
                loadDocuments();
                loadStats();
                closeDrawer();
            } else {
                const err = await res.json().catch(() => ({}));
                showToast(err.detail || 'Delete failed', 'error');
            }
        } catch (e) {
            showToast('Delete failed', 'error');
        }

        deleteModal.classList.remove('active');
        deleteModalConfirm.disabled = false;
        deleteModalConfirm.textContent = 'Delete';
        pendingDeleteId = null;
    });

    // ─────────────────────────────────────────
    // DOCUMENT DETAIL DRAWER
    // ─────────────────────────────────────────
    window._openDocDrawer = function(docId) {
        const doc = allDocuments.find(d => d.id === docId);
        if (!doc) return;

        drawerDocName.textContent = doc.filename;

        const statusColors = {
            ready: 'var(--color-success)',
            processing: 'var(--color-warning)',
            pending: 'var(--color-warning)',
            error: 'var(--color-error)',
        };

        const maxChunks = Math.max(...allDocuments.map(d => d.chunk_count), 1);
        const chunkPercent = Math.round((doc.chunk_count / maxChunks) * 100);

        drawerMeta.innerHTML = `
            <div class="drawer-field">
                <span class="drawer-field__label">Status</span>
                <span class="drawer-field__value" style="color: ${statusColors[doc.status] || 'inherit'}; font-weight: 600;">
                    ${doc.status.charAt(0).toUpperCase() + doc.status.slice(1)}
                    ${doc.error_message ? `<br><span style="color: var(--color-error); font-size: 0.75rem; font-weight: 400;">${escapeHtml(doc.error_message)}</span>` : ''}
                </span>
            </div>
            <div class="drawer-field">
                <span class="drawer-field__label">File Type</span>
                <span class="drawer-field__value">${(doc.doc_type || 'unknown').toUpperCase()}</span>
            </div>
            <div class="drawer-field">
                <span class="drawer-field__label">File Size</span>
                <span class="drawer-field__value drawer-field__value--mono">${formatFileSize(doc.file_size)}</span>
            </div>
            <div class="drawer-field">
                <span class="drawer-field__label">Chunks Indexed</span>
                <span class="drawer-field__value drawer-field__value--mono">${doc.chunk_count}</span>
                <div class="chunk-bar">
                    <div class="chunk-bar__fill" style="width: ${chunkPercent}%"></div>
                </div>
            </div>
            ${doc.uploader_email ? `
                <div class="drawer-field">
                    <span class="drawer-field__label">Uploaded By</span>
                    <span class="drawer-field__value">${escapeHtml(doc.uploader_email)}</span>
                </div>
            ` : ''}
            ${doc.created_at ? `
                <div class="drawer-field">
                    <span class="drawer-field__label">Upload Date</span>
                    <span class="drawer-field__value">${new Date(doc.created_at).toLocaleString()}</span>
                </div>
            ` : ''}
            <div class="drawer-field">
                <span class="drawer-field__label">Document ID</span>
                <span class="drawer-field__value drawer-field__value--mono">#${doc.id}</span>
            </div>
        `;

        docDrawer.classList.add('open');
        docDrawerOverlay.classList.add('active');
    };

    function closeDrawer() {
        docDrawer.classList.remove('open');
        docDrawerOverlay.classList.remove('active');
    }

    drawerClose.addEventListener('click', closeDrawer);
    docDrawerOverlay.addEventListener('click', closeDrawer);

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

    function formatDate(dateStr) {
        if (!dateStr) return '';
        const d = new Date(dateStr);
        const now = new Date();
        const diff = now - d;

        if (diff < 60000) return 'Just now';
        if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
        if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

    // ─── Init ───
    (async () => {
        const avatarEl = document.getElementById('avatarInitials');
        if (avatarEl) {
            try {
                const r = await sFetch(`${API}/auth/me`, { headers: authHeader() });
                if (r.ok) {
                    const d = await r.json();
                    const name = d.full_name || d.email || '';
                    const initials = name.trim().split(/\s+/).slice(0, 2).map(p => p[0].toUpperCase()).join('');
                    avatarEl.textContent = initials || 'U';
                }
            } catch {}
        }
    })();
    loadTeams();
});
