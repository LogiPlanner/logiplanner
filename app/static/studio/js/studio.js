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
    let activeSourceFilter = 'all';

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
    const sourceFilterTabs = document.getElementById('sourceFilterTabs');

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
        roleBadge.textContent = currentRole;
        roleBadge.className = `role-badge role-badge--${currentRole}`;

        const canEdit = currentRole === 'owner' || currentRole === 'editor';
        studioMain.classList.toggle('viewer-mode', !canEdit);
    }

    // ── Ingest Tab Switching ──
    const ingestTabs = document.querySelectorAll('.ingest-tab');
    const ingestPanes = document.querySelectorAll('.ingest-pane');

    ingestTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.dataset.tab;
            ingestTabs.forEach(t => t.classList.remove('ingest-tab--active'));
            ingestPanes.forEach(p => p.classList.remove('ingest-pane--active'));
            tab.classList.add('ingest-tab--active');
            const pane = document.querySelector(`.ingest-pane[data-pane="${target}"]`);
            if (pane) pane.classList.add('ingest-pane--active');
        });
    });

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
            updateSourceTabCounts();
            renderDocuments();
            updateReadyCount();

            // Auto-refresh stale Drive docs
            checkAutoRefresh(allDocuments);

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

    function getDocSource(doc) {
        if (doc.source_url) {
            if (doc.source_url.includes('drive.google.com')) return 'drive';
            if (doc.source_url.includes('github.com')) return 'github';
            return 'url';
        }
        if (doc.doc_type === 'text') return 'text';
        return 'files';
    }

    function updateSourceTabCounts() {
        if (!sourceFilterTabs) return;
        const counts = { all: allDocuments.length, files: 0, drive: 0, text: 0, url: 0, github: 0 };
        allDocuments.forEach(d => {
            const s = getDocSource(d);
            if (counts[s] !== undefined) counts[s]++;
            else counts[s] = 1;
        });
        Object.keys(counts).forEach(src => {
            const el = document.getElementById(`srcCount-${src}`);
            if (el) {
                el.textContent = counts[src];
                el.classList.toggle('source-tab__count--zero', counts[src] === 0);
            }
        });
    }

    function getFilteredDocs() {
        let docs = [...allDocuments];
        const search = (docSearch.value || '').toLowerCase().trim();
        const typeFilter = filterType.value;
        const statusFilter = filterStatus.value;

        if (activeSourceFilter !== 'all') {
            docs = docs.filter(d => getDocSource(d) === activeSourceFilter);
        }

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
                            ${doc.source_url ? `
                                <button class="doc-card__action-btn doc-card__action-btn--refresh" onclick="event.stopPropagation(); window._refreshDoc(${doc.id})" title="Refresh from source">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
                                </button>
                            ` : ''}
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
                        ${doc.source_url ? `
                            <span class="doc-card__meta-item doc-card__meta-item--drive">
                                <svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12"><path d="M7.71 3.5L1.15 15l3.43 5.97L11.14 9.47 7.71 3.5zm1.14 0l6.86 11.93H22.86L16 3.5H8.85zM16.57 16.5H3.43L0 22.5h24l-3.43-6H16.57z"/></svg>
                                Drive
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

    // Source filter tabs
    if (sourceFilterTabs) {
        sourceFilterTabs.addEventListener('click', (e) => {
            const btn = e.target.closest('.source-tab');
            if (!btn) return;
            activeSourceFilter = btn.dataset.source || 'all';
            sourceFilterTabs.querySelectorAll('.source-tab').forEach(t => t.classList.remove('source-tab--active'));
            btn.classList.add('source-tab--active');
            renderDocuments();
        });
    }

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
            ${doc.source_url ? `
                <div class="drawer-field">
                    <span class="drawer-field__label">Source URL</span>
                    <span class="drawer-field__value"><a href="${escapeHtml(doc.source_url)}" target="_blank" rel="noopener noreferrer" style="color:var(--color-primary);word-break:break-all;">${escapeHtml(doc.source_url)}</a></span>
                </div>
            ` : ''}
            ${doc.last_synced_at ? `
                <div class="drawer-field">
                    <span class="drawer-field__label">Last Synced</span>
                    <span class="drawer-field__value">${new Date(doc.last_synced_at).toLocaleString()}</span>
                </div>
            ` : ''}
            ${doc.refresh_interval_hours ? `
                <div class="drawer-field">
                    <span class="drawer-field__label">Auto-refresh</span>
                    <span class="drawer-field__value">Every ${doc.refresh_interval_hours}h</span>
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

    // ─────────────────────────────────────────
    // GOOGLE DRIVE INTEGRATION
    // ─────────────────────────────────────────
    window.openDriveModal = function() {
        const modal = document.getElementById('driveModal');
        if (!modal) return;
        modal.classList.add('active');
        setTimeout(() => {
            const input = document.getElementById('driveUrlInput');
            if (input) input.focus();
        }, 60);
    };

    window.closeDriveModal = function() {
        const modal = document.getElementById('driveModal');
        if (!modal) return;
        modal.classList.remove('active');
        const status = document.getElementById('driveStatus');
        if (status) { status.textContent = ''; status.className = 'drive-modal__status'; }
    };

    window.importDriveDoc = async function() {
        const urlInput = document.getElementById('driveUrlInput');
        const intervalSel = document.getElementById('driveRefreshInterval');
        const statusEl = document.getElementById('driveStatus');
        const url = urlInput.value.trim();

        if (!url) { showToast('Please enter a Google Drive URL', 'error'); return; }
        if (!currentTeamId) { showToast('Please select a team first', 'error'); return; }

        const refreshHours = intervalSel.value ? parseInt(intervalSel.value, 10) : null;

        const importBtn = document.getElementById('driveImportBtn');
        statusEl.textContent = 'Importing…';
        statusEl.className = 'drive-modal__status drive-modal__status--loading';
        if (importBtn) { importBtn.disabled = true; }

        try {
            const res = await sFetch(`${API}/rag/ingest-drive`, {
                method: 'POST',
                headers: jsonHeaders(),
                body: JSON.stringify({
                    team_id: currentTeamId,
                    drive_url: url,
                    refresh_interval_hours: refreshHours,
                }),
            });

            if (res.ok) {
                closeDriveModal();
                showToast('Drive import queued — processing in background', 'success');
                urlInput.value = '';
                loadDocuments();
                loadStats();
            } else {
                const err = await res.json().catch(() => ({}));
                statusEl.textContent = err.detail || 'Import failed';
                statusEl.className = 'drive-modal__status drive-modal__status--error';
                if (importBtn) importBtn.disabled = false;
            }
        } catch (e) {
            statusEl.textContent = 'Import failed';
            statusEl.className = 'drive-modal__status drive-modal__status--error';
            if (importBtn) importBtn.disabled = false;
        }
    };

    window._refreshDoc = async function(docId) {
        if (!currentTeamId) return;
        const btn = document.querySelector(`.doc-card[data-id="${docId}"] .doc-card__action-btn--refresh`);
        if (btn) btn.classList.add('spin-active');

        try {
            const res = await sFetch(`${API}/rag/documents/${docId}/refresh`, {
                method: 'POST',
                headers: jsonHeaders(),
            });

            if (res.ok) {
                showToast('Document refresh started', 'success');
                loadDocuments();
            } else {
                const err = await res.json().catch(() => ({}));
                showToast(err.detail || 'Refresh failed', 'error');
            }
        } catch (e) {
            showToast('Refresh failed', 'error');
        } finally {
            if (btn) btn.classList.remove('spin-active');
        }
    };

    // Auto-refresh stale Drive docs on load
    function checkAutoRefresh(docs) {
        const now = Date.now();
        docs.forEach(doc => {
            if (!doc.source_url || !doc.refresh_interval_hours) return;
            if (doc.status === 'processing' || doc.status === 'pending') return;
            const lastSync = doc.last_synced_at ? new Date(doc.last_synced_at).getTime() : 0;
            const intervalMs = doc.refresh_interval_hours * 3600000;
            if (now - lastSync > intervalMs) {
                // Trigger background refresh silently
                sFetch(`${API}/rag/documents/${doc.id}/refresh`, {
                    method: 'POST',
                    headers: jsonHeaders(),
                }).catch(() => {});
            }
        });
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
