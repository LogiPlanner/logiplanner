document.addEventListener('DOMContentLoaded', () => {
    const token = localStorage.getItem('access_token');
    if (!token) { window.location.href = '/login'; return; }

    const headers = {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
    };

    // DOM Elements
    const projectTitle = document.getElementById('projectTitle');
    const timelineContainer = document.getElementById('timelineContainer');
    const timelineEmpty = document.getElementById('timelineEmpty');
    const searchInput = document.getElementById('searchInput');
    const topbarNavLinks = document.querySelectorAll('#topbarNav a');
    
    // Analytics Elements
    const statDecisions = document.getElementById('statDecisions');
    const statMilestones = document.getElementById('statMilestones');
    const focusDistributionList = document.getElementById('focusDistributionList');
    const activeParticipants = document.getElementById('activeParticipants');
    
    // Headers 
    const notifBtn = document.getElementById('notifBtn');
    const notifDot = document.getElementById('notifDot');
    const notifDropdown = document.getElementById('notifDropdown');
    const notifList = document.getElementById('notifList');
    const filterBtn = document.getElementById('filterBtn');
    const filterDropdown = document.getElementById('filterDropdown');
    const sortBox = document.getElementById('sortBox');
    
    // Advanced Filters
    const impactChecks = document.querySelectorAll('.impact-check');
    const filterCollab = document.getElementById('filterCollab');
    const filterTags = document.getElementById('filterTags');
    const exportBtn = document.getElementById('exportBtn');

    // Modals
    const addEntryFab = document.getElementById('addEntryFab');
    const cancelEntryBtn = document.getElementById('cancelEntryBtn');
    const entryModal = document.getElementById('entryModal');
    const entryForm = document.getElementById('entryForm');
    const modalTitle = document.getElementById('modalTitle');
    const editEntryId = document.getElementById('editEntryId');
    const saveEntryBtn = document.getElementById('saveEntryBtn');

    const deleteConfirmModal = document.getElementById('deleteConfirmModal');
    const cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
    const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');

    const errorModal = document.getElementById('errorModal');
    const errorModalDesc = document.getElementById('errorModalDesc');
    const closeErrorBtn = document.getElementById('closeErrorBtn');

    closeErrorBtn?.addEventListener('click', () => {
        errorModal.classList.remove('active');
    });

    function showError(message) {
        if(errorModalDesc) errorModalDesc.textContent = message;
        if(errorModal) errorModal.classList.add('active');
    }

    let allEntries = [];
    let projectUsers = [];
    let currentProjectId = null;
    let currentFilter = 'all';
    let entryToDelete = null;

    // --- FETCH DATA ---

    async function fetchProjects() {
        try {
            const res = await fetch('/api/v1/timeline/projects', { headers });
            if (res.ok) {
                const projects = await res.json();
                if (projects.length > 0) {
                    currentProjectId = projects[0].id;
                    projectTitle.textContent = projects[0].project_name;
                    loadProjectData(currentProjectId);
                } else {
                    projectTitle.textContent = "No Projects";
                    timelineEmpty.style.display = 'block';
                }
            } else if (res.status === 401) {
                window.location.href = '/login';
            }
        } catch(e) {
            console.error('Failed to fetch projects', e);
        }
    }

    async function loadProjectData(projectId) {
        fetchTimeline(projectId);
        fetchAnalytics(projectId);
        fetchProjectUsers(projectId);
    }
    
    async function fetchProjectUsers(projectId) {
        try {
            const res = await fetch(`/api/v1/timeline/project/${projectId}/users`, { headers });
            if (res.ok) {
                projectUsers = await res.json();
            }
        } catch(e) {
            console.error('Failed to fetch users for mentions', e);
        }
    }

    async function fetchTimeline(projectId) {
        try {
            const res = await fetch(`/api/v1/timeline/project/${projectId}`, { headers });
            if (res.ok) {
                const newData = await res.json();
                if (allEntries.length > 0 && newData.length > allEntries.length) {
                    // Check for new entries by id
                    const existingIds = new Set(allEntries.map(e => e.id));
                    const newItems = newData.filter(e => !existingIds.has(e.id));
                    
                    if (newItems.length > 0) {
                        notifDot.style.display = 'block';
                        newItems.forEach(item => {
                            addNotification(`New ${item.entry_type} added: "${item.title}"`);
                        });
                    }
                }
                allEntries = newData;
                applyFiltersAndRender();
            }
        } catch(e) {
            console.error('Failed to fetch timeline', e);
        }
    }

    function addNotification(message) {
        if (notifList.querySelector('.empty')) {
            notifList.innerHTML = '';
        }
        const timeStr = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        const html = `
            <div class="notif-item">
                <span class="n-title">${escapeHtml(message)}</span>
                <span class="n-time">${timeStr}</span>
            </div>
        `;
        notifList.insertAdjacentHTML('afterbegin', html);
    }

    async function fetchAnalytics(projectId) {
        try {
            const res = await fetch(`/api/v1/timeline/project/${projectId}/analytics`, { headers });
            if (res.ok) {
                const data = await res.json();
                statDecisions.textContent = data.decisions_count;
                statMilestones.textContent = data.milestones_count;
                activeParticipants.textContent = data.active_participants_count;
                
                // Render Focus
                const focusHtml = Object.entries(data.focus_distribution).map(([tag, pct]) => `
                    <div class="focus-item">
                        <div class="focus-item-header">
                            <span>${escapeHtml(tag)}</span>
                            <span class="focus-pct">${pct}%</span>
                        </div>
                        <div class="progress-bg"><div class="progress-fill" style="width: ${pct}%"></div></div>
                    </div>
                `).join('');
                focusDistributionList.innerHTML = focusHtml || '<div class="focus-item"><span>No data</span></div>';
            }
        } catch(e) {
            console.error('Failed to fetch analytics', e);
        }
    }

    // --- RENDER TIMELINE ---

    function applyFiltersAndRender() {
        const query = searchInput.value.toLowerCase();
        
        let filtered = allEntries;
        
        // 1. Type Filter from Nav
        if (currentFilter !== 'all') {
            filtered = filtered.filter(e => e.entry_type === currentFilter);
        }

        // 1.5 Advanced Filters logic
        const checkedImpacts = Array.from(impactChecks).filter(cb => cb.checked).map(cb => cb.value);
        if (checkedImpacts.length > 0) {
            filtered = filtered.filter(e => checkedImpacts.includes(e.impact_level || 'none'));
        }
        
        const collabFilter = filterCollab.value.toLowerCase();
        if (collabFilter) {
            filtered = filtered.filter(e => e.collaborators && e.collaborators.toLowerCase().includes(collabFilter));
        }
        
        const tagsFilter = filterTags.value.toLowerCase();
        if (tagsFilter) {
            filtered = filtered.filter(e => e.tags && e.tags.toLowerCase().includes(tagsFilter));
        }

        // 2. Search Box Filter
        if (query) {
            filtered = filtered.filter(entry => 
                entry.title.toLowerCase().includes(query) || 
                entry.content.toLowerCase().includes(query) || 
                (entry.tags && entry.tags.toLowerCase().includes(query))
            );
        }
        
        // 3. Sort
        const sortOrder = sortBox.value;
        filtered.sort((a,b) => {
            const tA = new Date(a.created_at).getTime();
            const tB = new Date(b.created_at).getTime();
            return sortOrder === 'newest' ? tB - tA : tA - tB;
        });

        renderTimeline(filtered);
    }

    function renderTimeline(entries) {
        document.querySelectorAll('.timeline-entry').forEach(e => e.remove());
        
        if (entries.length === 0) {
            timelineEmpty.style.display = 'block';
            return;
        }
        
        timelineEmpty.style.display = 'none';
        
        const html = entries.map(entry => {
            const date = new Date(entry.created_at);
            const dateStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
            const timeStr = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
            
            // Fix source URL
            let sourceUrl = entry.source_reference;
            if (sourceUrl && !sourceUrl.match(/^https?:\/\//i)) {
                sourceUrl = 'https://' + sourceUrl;
            }

            let sourceHtml = '';
            if (sourceUrl) {
                sourceHtml = `<div class="entry-links">
                    <a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">View Reference Resource</a>
                </div>`;
            }

             // Criticality Badge
            let impactHtml = '';
            if (entry.impact_level === 'critical') {
                impactHtml = `<span class="entry-badge impact-critical">• CRITICAL</span>`;
            } else if (entry.impact_level === 'high') {
                impactHtml = `<span class="entry-badge impact-high">• HIGH</span>`;
            } else if (entry.impact_level === 'medium') {
                impactHtml = `<span class="entry-badge impact-medium">• MEDIUM</span>`;
            } else if (entry.impact_level === 'low') {
                impactHtml = `<span class="entry-badge impact-low">• LOW</span>`;
            }

            // Collaborators Stack
            let collaboratorsHtml = '';
            if (entry.collaborators) {
                const collabList = entry.collaborators.split(',').map(s => s.trim()).filter(s => s);
                if (collabList.length > 0) {
                    const toShow = collabList.slice(0, 2);
                    const overflow = collabList.length - 2;
                    let stackHtml = toShow.map((c, idx) => {
                        const init = c.substring(0,1).toUpperCase();
                        const colors = ['bg-indigo', 'bg-teal', 'bg-rose'];
                        return `<div class="collab-avatar ${colors[idx % colors.length]}" style="z-index:${10-idx}">${init}</div>`;
                    }).join('');
                    if (overflow > 0) {
                        stackHtml += `<div class="collab-overflow">+${overflow}</div>`;
                    }
                    collaboratorsHtml = `<div class="collaborator-stack">${stackHtml}</div>`;
                }
            }

            // Tags
            let tagsHtml = '';
            if (entry.tags) {
                tagsHtml = `<div class="entry-tags">` + 
                    entry.tags.split(',').map(t => `<span class="tag-pill">${escapeHtml(t.trim())}</span>`).join('') +
                    `</div>`;
            }

            let iconName = 'book';
            let iconClass = 'icon-summary';
            if (entry.entry_type === 'milestone') { iconName = 'lightbulb'; iconClass = 'icon-milestone'; }
            if (entry.entry_type === 'decision') { iconName = 'gavel'; iconClass = 'icon-decision'; }
            if (entry.entry_type === 'upload') { iconName = 'upload_file'; iconClass = 'icon-upload'; }

            // Author Initials
            const author = entry.author_name || 'User';
            const initials = author.substring(0, 1).toUpperCase();

            // Card HTML
            return `
                <div class="timeline-entry">
                    <div class="entry-icon ${iconClass}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" style="width:20px;height:20px;">
                            ${getIconPath(iconName)}
                        </svg>
                    </div>
                    <div class="entry-card">
                        <div class="entry-header">
                            <div class="entry-badge-wrap">
                                <span class="entry-badge badge-${entry.entry_type}">${entry.entry_type}</span>
                                ${impactHtml}
                            </div>
                            <span class="entry-time">${dateStr} • ${timeStr}</span>
                        </div>
                        <h4 class="entry-title">${escapeHtml(entry.title)}</h4>
                        <p class="entry-content">${escapeHtml(entry.content)}</p>
                        ${tagsHtml}
                        <div class="entry-footer">
                            <div class="entry-author">
                                <div class="author-avatar">${initials}</div>
                                <span class="author-name">${escapeHtml(author)}</span>
                                ${collaboratorsHtml}
                            </div>
                            <div class="entry-actions">
                                ${sourceHtml}
                                <button class="action-btn" onclick="window.editTimelineEntry(${entry.id})">Edit</button>
                                <button class="action-btn delete" onclick="window.confirmDeleteTimelineEntry(${entry.id})">Delete</button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
        
        timelineContainer.insertAdjacentHTML('beforeend', html);
    }

    function getIconPath(name) {
        if(name === 'lightbulb') return `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547z"/>`;
        if(name === 'gavel') return `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3"/>`;
        if(name === 'upload_file') return `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/>`;
        return `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477-4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/>`;
    }

    function escapeHtml(unsafe) {
        if (!unsafe) return '';
        return unsafe.toString()
             .replace(/&/g, "&amp;")
             .replace(/</g, "&lt;")
             .replace(/>/g, "&gt;")
             .replace(/"/g, "&quot;")
             .replace(/'/g, "&#039;");
    }

    // --- SEARCH / FILTER LOGIC ---
    
    searchInput.addEventListener('input', applyFiltersAndRender);

    topbarNavLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            topbarNavLinks.forEach(l => l.classList.remove('active'));
            link.classList.add('active');
            currentFilter = link.dataset.filter;
            applyFiltersAndRender();
        });
    });

    // --- EXPORT TO CSV ---
    exportBtn?.addEventListener('click', () => {
        if (!allEntries || allEntries.length === 0) return alert("Nothing to export yet.");
        
        const headersCSV = "Date,Type,Title,Content,Author,Tags,ReferenceURL\n";
        const rows = allEntries.map(e => {
            const date = new Date(e.created_at).toLocaleString();
            const textContent = (e.content || "").replace(/"/g, '""');
            const title = (e.title || "").replace(/"/g, '""');
            return `"${date}","${e.entry_type}","${title}","${textContent}","${e.author_name || ""}","${e.tags || ""}","${e.source_reference || ""}"`;
        }).join('\n');

        const csvString = headersCSV + rows;
        const blob = new Blob([csvString], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Project_Memory_${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        window.URL.revokeObjectURL(url);
    });

    notifBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        notifDot.style.display = 'none'; // Acknowledge notifications
        notifDropdown.style.display = notifDropdown.style.display === 'none' ? 'block' : 'none';
        filterDropdown.style.display = 'none';
    });
    
    filterBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        filterDropdown.style.display = filterDropdown.style.display === 'none' ? 'block' : 'none';
        notifDropdown.style.display = 'none';
    });

    document.addEventListener('click', (e) => {
        if (!notifBtn.contains(e.target) && !notifDropdown.contains(e.target)) {
            notifDropdown.style.display = 'none';
        }
        if (!filterBtn.contains(e.target) && !filterDropdown.contains(e.target)) {
            filterDropdown.style.display = 'none';
        }
    });

    sortBox.addEventListener('change', applyFiltersAndRender);
    impactChecks.forEach(cb => cb.addEventListener('change', applyFiltersAndRender));
    filterCollab.addEventListener('input', applyFiltersAndRender);
    filterTags.addEventListener('input', applyFiltersAndRender);

    // --- EDIT & DELETE ---

    window.confirmDeleteTimelineEntry = function(id) {
        entryToDelete = id;
        deleteConfirmModal.classList.add('active');
    };

    cancelDeleteBtn.addEventListener('click', () => {
        deleteConfirmModal.classList.remove('active');
        entryToDelete = null;
    });

    confirmDeleteBtn.addEventListener('click', async () => {
        if (!entryToDelete || !currentProjectId) return;
        
        confirmDeleteBtn.textContent = "Deleting...";
        try {
            const res = await fetch(`/api/v1/timeline/${entryToDelete}`, {
                method: 'DELETE',
                headers
            });
            if (res.ok) {
                loadProjectData(currentProjectId);
            } else {
                showError("Failed to delete entry.");
            }
        } catch(e) {
            console.error(e);
            showError("Network error deleting entry.");
        } finally {
            confirmDeleteBtn.textContent = "Delete Entry";
            deleteConfirmModal.classList.remove('active');
            entryToDelete = null;
        }
    });

    window.editTimelineEntry = function(id) {
        const entry = allEntries.find(e => e.id === id);
        if(!entry) return;

        editEntryId.value = entry.id;
        document.getElementById('entryType').value = entry.entry_type;
        document.getElementById('entryTitle').value = entry.title;
        document.getElementById('entryContent').value = entry.content;
        document.getElementById('entrySource').value = entry.source_reference || '';
        document.getElementById('entryTags').value = entry.tags || '';

        document.getElementById('entryImpact').value = entry.impact_level || 'none';
        document.getElementById('entryCollaborators').value = entry.collaborators || '';

        modalTitle.textContent = "Edit Memory Entry";
        saveEntryBtn.textContent = "Update Entry";
        entryModal.classList.add('active');
    };

    addEntryFab.addEventListener('click', () => {
        editEntryId.value = "";
        entryForm.reset();
        document.getElementById('entryCollaborators').value = '';
        
        modalTitle.textContent = "Add Memory Entry";
        saveEntryBtn.textContent = "Save Entry";
        entryModal.classList.add('active');
    });

    cancelEntryBtn.addEventListener('click', () => {
        entryModal.classList.remove('active');
        entryForm.reset();
        editEntryId.value = "";
    });

    entryForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!currentProjectId) return alert('No project selected.');

        const isEditing = !!editEntryId.value;
        const url = isEditing ? `/api/v1/timeline/${editEntryId.value}` : '/api/v1/timeline/';
        const method = isEditing ? 'PUT' : 'POST';

        const payload = {
            entry_type: document.getElementById('entryType').value,
            title: document.getElementById('entryTitle').value,
            content: document.getElementById('entryContent').value,
            source_reference: document.getElementById('entrySource').value || null,
            tags: document.getElementById('entryTags').value || null,
            impact_level: document.getElementById('entryImpact').value,
            collaborators: document.getElementById('entryCollaborators').value || null
        };
        
        if (!isEditing) {
            payload.project_id = currentProjectId;
        }

        const originalText = saveEntryBtn.textContent;
        saveEntryBtn.textContent = isEditing ? 'Updating...' : 'Saving...';
        saveEntryBtn.disabled = true;

        try {
            const res = await fetch(url, {
                method: method,
                headers,
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                entryModal.classList.remove('active');
                entryForm.reset();
                editEntryId.value = "";
                loadProjectData(currentProjectId);
            } else {
                const data = await res.json();
                showError(data.detail || 'Error saving entry');
            }
        } catch(err) {
            console.error(err);
            showError('A network error occurred.');
        } finally {
            saveEntryBtn.textContent = originalText;
            saveEntryBtn.disabled = false;
        }
    });

    // Init
    fetchProjects();

    // Simple Polling Simulator for Notifications
    setInterval(() => {
        if(currentProjectId) {
            fetchTimeline(currentProjectId); // silently updates and triggers dot
        }
    }, 15000);

    // --- AUTO-FILL DOCUMENT AI ---
    const autoFillBtn = document.getElementById('autoFillBtn');
    const autoFillFile = document.getElementById('autoFillFile');

    autoFillBtn?.addEventListener('click', () => {
        autoFillFile.click();
    });

    autoFillFile?.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const originalText = autoFillBtn.textContent;
        autoFillBtn.textContent = '✨ Analyzing...';
        autoFillBtn.disabled = true;

        const formData = new FormData();
        formData.append('file', file);

        try {
            const res = await fetch('/api/v1/timeline/auto-fill', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + token
                },
                body: formData
            });

            if (res.ok) {
                const aiData = await res.json();
                document.getElementById('entryTitle').value = aiData.title || '';
                document.getElementById('entryContent').value = aiData.content || '';
                document.getElementById('entryTags').value = aiData.tags || '';
            } else {
                const err = await res.json();
                showError(err.detail || 'Unknown extraction error occurred.');
            }
        } catch (error) {
            console.error("Auto-fill error:", error);
            showError("Error communicating with AI Brain for auto-fill.");
        } finally {
            autoFillBtn.textContent = originalText;
            autoFillBtn.disabled = false;
            autoFillFile.value = '';
        }
    });

    // --- @ MENTIONS DROPDOWN ---
    const mentionDropdown = document.getElementById('mentionDropdown');
    const entryCollaborators = document.getElementById('entryCollaborators');

    function escapeRegExp(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
    }

    entryCollaborators?.addEventListener('input', (e) => {
        const val = e.target.value;
        const segments = val.split(',');
        const lastPart = segments[segments.length - 1];
        
        // If they are typing immediately after an @
        if (lastPart && lastPart.includes('@')) {
            const mentionQuery = lastPart.split('@').pop().toLowerCase();
            
            let html = projectUsers
                .filter(u => u.full_name.toLowerCase().includes(mentionQuery))
                .map(u => `
                <div class="mention-item" data-name="${escapeHtml(u.full_name)}">
                    ${escapeHtml(u.full_name)}
                </div>
            `).join('');

            // Add other fallback
            html += `<div class="mention-item" data-name="${escapeHtml(mentionQuery) || 'Other'}">Unknown ("${escapeHtml(mentionQuery)}")</div>`;
            
            mentionDropdown.innerHTML = html;
            mentionDropdown.style.display = 'flex';

            // Bind clicks
            mentionDropdown.querySelectorAll('.mention-item').forEach(item => {
                item.addEventListener('click', () => {
                    const name = item.getAttribute('data-name');
                    // Replace the `@...` part with the selected name
                    let updatedLastPart = lastPart.replace(new RegExp('@' + escapeRegExp(mentionQuery) + '$'), name);
                    segments[segments.length - 1] = updatedLastPart;
                    entryCollaborators.value = segments.join(',').trim() + ', ';
                    mentionDropdown.style.display = 'none';
                    entryCollaborators.focus();
                });
            });
        } else {
            mentionDropdown.style.display = 'none';
        }
    });

    // Hide mentions drop when clicked away
    document.addEventListener('click', (e) => {
        if (entryCollaborators && !entryCollaborators.contains(e.target) && mentionDropdown && !mentionDropdown.contains(e.target)) {
            mentionDropdown.style.display = 'none';
        }
    });

});
