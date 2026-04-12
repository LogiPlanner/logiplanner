document.addEventListener('DOMContentLoaded', () => {
    const token = localStorage.getItem('access_token');
    if (!token) { window.location.href = '/login'; return; }

    const headers = {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
    };

    // Use the shared authFetch from common.js (handles token refresh + logout)
    const mFetch = (url, opts = {}) => window.__lp.authFetch(url, opts);

    // DOM Elements
    const timelineContainer = document.getElementById('timelineContainer');
    const timelineEmpty = document.getElementById('timelineEmpty');
    const searchInput = document.getElementById('searchInput');
    const topbarNavLinks = document.querySelectorAll('#topbarNav a');
    const projectTitle = document.getElementById('projectTitle');
    
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
    let currentTeamId = null;
    let currentSubteamId = 'all';
    let currentSubteamName = 'All Teams';
    let currentFilter = 'all';
    let entryToDelete = null;
    let editingEntrySubteamId = null;

    // --- FETCH DATA ---

    function getSelectedSubteamScope() {
        const storedId = localStorage.getItem('selected_subteam_id') || 'all';
        const scopeNameEl = document.getElementById('activeSubteamName');
        return {
            id: storedId,
            name: scopeNameEl?.textContent?.trim() || (storedId === 'all' ? 'All Teams' : 'Team')
        };
    }

    function updateScopeHeader() {
        const subtitleEl = document.getElementById('timelineSubtitle');
        if (!subtitleEl) return;
        subtitleEl.textContent = 'Timeline for ' + currentSubteamName;
    }

    function updateCreateControls() {
        if (!addEntryFab) return;
        const canCreate = currentSubteamId !== 'all';
        addEntryFab.style.opacity = canCreate ? '1' : '0.65';
        addEntryFab.style.cursor = canCreate ? 'pointer' : 'not-allowed';
        addEntryFab.title = canCreate ? 'Add Memory Entry' : 'Select a team in the sidebar to add a memory entry';
    }

    async function fetchTeams() {
        try {
            const res = await mFetch('/api/v1/timeline/teams', { headers });
            if (res.ok) {
                const teams = await res.json();
                if (teams.length > 0) {
                    // Pick the team matching localStorage, or fall back to first
                    const savedTeam = localStorage.getItem('selected_team_id');
                    const matched = savedTeam && teams.find(t => t.id === parseInt(savedTeam));
                    const chosen = matched || teams[0];
                    currentTeamId = chosen.id;
                    if (projectTitle) {
                        projectTitle.textContent = chosen.team_name || 'Project Memory';
                    }
                    syncScopeFromSidebar();
                    loadTeamData(chosen.id, currentSubteamId);
                } else {
                    if (projectTitle) projectTitle.textContent = 'Project Memory';
                    timelineEmpty.style.display = 'block';
                }
            } else {
                // Non-2xx (401, 403, 500, etc.) — don't leave the page frozen
                console.warn('Failed to load teams, status:', res.status);
                if (projectTitle) projectTitle.textContent = 'Project Memory';
                if (timelineEmpty) timelineEmpty.style.display = 'block';
            }
        } catch(e) {
            console.error('Failed to fetch teams', e);
            if (projectTitle) projectTitle.textContent = 'Project Memory';
            if (timelineEmpty) timelineEmpty.style.display = 'block';
        }
    }

    function syncScopeFromSidebar() {
        const scope = getSelectedSubteamScope();
        currentSubteamId = scope.id || 'all';
        currentSubteamName = scope.name || 'All Teams';
        updateScopeHeader();
        updateCreateControls();
    }

    async function loadTeamData(teamId, subteamId = currentSubteamId) {
        syncScopeFromSidebar();
        fetchTimeline(teamId, subteamId);
        fetchAnalytics(teamId, subteamId);
        fetchTeamUsers(teamId, subteamId);
        loadAIInsights(); // Load AI Project Insights
    }
    
    async function fetchTeamUsers(teamId, subteamId = 'all') {
        try {
            const usersUrl = subteamId && subteamId !== 'all'
                ? `/api/v1/timeline/team/${teamId}/users?subteam_id=${encodeURIComponent(subteamId)}`
                : `/api/v1/timeline/team/${teamId}/users`;
            const res = await fetch(usersUrl, { headers });
            if (res.ok) {
                projectUsers = await res.json();
            }
        } catch(e) {
            console.error('Failed to fetch users for mentions', e);
        }
    }

    async function fetchTimeline(teamId, subteamId = 'all') {
        try {
            const timelineUrl = subteamId && subteamId !== 'all'
                ? `/api/v1/timeline/team/${teamId}?subteam_id=${encodeURIComponent(subteamId)}`
                : `/api/v1/timeline/team/${teamId}`;
            const res = await mFetch(timelineUrl, { headers });

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
                        // Automatically refresh AI Insights when new items arrive
                        loadAIInsights();
                    }
                }
                allEntries = newData;
                applyFiltersAndRender();
                if (typeof initApexCharts === 'function') initApexCharts(allEntries);
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

    async function fetchAnalytics(teamId, subteamId = 'all') {
        try {
            const analyticsUrl = subteamId && subteamId !== 'all'
                ? `/api/v1/timeline/team/${teamId}/analytics?subteam_id=${encodeURIComponent(subteamId)}`
                : `/api/v1/timeline/team/${teamId}/analytics`;
            const res = await mFetch(analyticsUrl, { headers });
            if (res.ok) {
                const data = await res.json();
                statDecisions.textContent = data.decisions_count;
                statMilestones.textContent = data.milestones_count;
                if (activeParticipants) activeParticipants.textContent = data.active_participants_count;
                
                // Render Focus
                const allTags = Object.entries(data.focus_distribution);
                // Sort tags by percentage descending
                allTags.sort((a,b) => b[1] - a[1]);
                
                const topTagsHtml = allTags.slice(0, 5).map(([tag, pct]) => `
                    <div class="focus-item">
                        <div class="focus-item-header">
                            <span>${escapeHtml(tag)}</span>
                            <span class="focus-pct">${pct}%</span>
                        </div>
                        <div class="progress-bg"><div class="progress-fill" style="width: ${pct}%"></div></div>
                    </div>
                `).join('');
                
                let hiddenHtml = '';
                let toggleHtml = '';
                if(allTags.length > 5) {
                    hiddenHtml = `
                    <div id="hiddenFocusTags" style="display:none; flex-direction:column; gap:1.5rem; margin-top:1.5rem;">
                        ${allTags.slice(5).map(([tag, pct]) => `
                            <div class="focus-item">
                                <div class="focus-item-header">
                                    <span>${escapeHtml(tag)}</span>
                                    <span class="focus-pct">${pct}%</span>
                                </div>
                                <div class="progress-bg"><div class="progress-fill" style="width: ${pct}%"></div></div>
                            </div>
                        `).join('')}
                    </div>`;
                    
                    toggleHtml = `
                    <button id="toggleFocusTagsBtn" class="show-more-toggle" style="margin-top:1rem; width:100%; justify-content:center;">
                        View ${allTags.length - 5} More Themes
                    </button>
                    `;
                }
                
                focusDistributionList.innerHTML = (topTagsHtml + hiddenHtml + toggleHtml) || '<div class="focus-item"><span>No data</span></div>';
                
                const toggleBtn = document.getElementById('toggleFocusTagsBtn');
                if(toggleBtn) {
                    toggleBtn.addEventListener('click', () => {
                        const h = document.getElementById('hiddenFocusTags');
                        if(h.style.display === 'none') {
                            h.style.display = 'flex';
                            toggleBtn.textContent = 'Hide Extra Themes';
                        } else {
                            h.style.display = 'none';
                            toggleBtn.textContent = `View ${allTags.length - 5} More Themes`;
                        }
                    });
                }
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
        renderActiveTags(allEntries);
        renderTopContributors(allEntries);
    }
    
    function renderTopContributors(entries) {
        const container = document.getElementById('topContributorsContainer');
        if (!container) return;
        const counts = {};
        entries.forEach(e => {
            const author = e.author_name || 'System';
            counts[author] = (counts[author] || 0) + 1;
        });
        
        const sortedAuthors = Object.entries(counts).sort((a,b) => b[1] - a[1]).slice(0, 3);
        if (sortedAuthors.length === 0) {
            container.innerHTML = '<span style="font-size:0.75rem; color:#94a3b8;">No contributions yet.</span>';
            return;
        }
        
        const maxScore = sortedAuthors[0][1];
        
        container.innerHTML = sortedAuthors.map(([author, count], index) => {
            const width = Math.max(15, (count / maxScore) * 100);
            const medal = index === 0 ? '🏆' : (index === 1 ? '🥈' : '🥉');
            return `
            <div style="font-size: 0.8rem;">
                <div style="display:flex; justify-content:space-between; margin-bottom:0.25rem;">
                    <span style="font-weight:600; color:var(--color-on-surface); text-transform:capitalize;">${escapeHtml(author)} ${medal}</span>
                    <span style="color:#64748b; font-weight:700;">${count}</span>
                </div>
                <div style="background: var(--color-surface-high); border-radius: 999px; height: 6px; width: 100%; overflow:hidden;">
                    <div style="background: var(--color-primary); width: ${width}%; height: 100%; border-radius: 999px; transition: width 1s;"></div>
                </div>
            </div>
            `;
        }).join('');
    }
    
    function renderActiveTags(entries) {
        const container = document.getElementById('activeTagsContainer');
        if (!container) return;
        const tagCounts = {};
        entries.forEach(e => {
            if (e.tags) {
                e.tags.split(',').map(t => t.trim()).filter(t => t).forEach(t => {
                    tagCounts[t] = (tagCounts[t] || 0) + 1;
                });
            }
        });
        
        const sortedTags = Object.entries(tagCounts).sort((a,b) => b[1] - a[1]).slice(0, 8);
        if (sortedTags.length === 0) {
            container.innerHTML = '<span style="font-size:0.75rem; color:#94a3b8;">No themes tracked yet.</span>';
            return;
        }
        
        container.innerHTML = sortedTags.map(([t, count]) => `
            <span style="font-size:0.7rem; font-weight:600; padding:0.25rem 0.6rem; background:rgba(79, 70, 229, 0.1); color:#4f46e5; border-radius:999px;">
                ${escapeHtml(t)}
            </span>
        `).join('');
    }
    
    let aiInsightsLoading = false;

    async function loadAIInsights() {
        if (!currentTeamId || aiInsightsLoading) return;
        aiInsightsLoading = true;
        
        const loadingEl = document.getElementById('aiSuggestionsLoading');
        const emptyEl = document.getElementById('aiSuggestionsEmpty');
        const listEl = document.getElementById('aiSuggestionsList');
        
        if (loadingEl) loadingEl.style.display = 'flex';
        if (emptyEl) emptyEl.style.display = 'none';
        if (listEl) listEl.innerHTML = '';
        
        try {
            // Ask AI to summarize the recent events
            const queryText = encodeURIComponent("Summarize the last 5 project timeline entries in a short paragraph and/or bullet points.");
            const res = await mFetch(`/api/v1/timeline/team/${currentTeamId}/ask?query=${queryText}`, { headers });
            
            if (loadingEl) loadingEl.style.display = 'none';
            aiInsightsLoading = false;

            if (res.ok) {
                const data = await res.json();
                if (data.response) {
                    // Use marked.js to parse markdown properly
                    const safeHtml = window.marked ? window.marked.parse(data.response) : escapeHtml(data.response).replace(/\n/g, '<br>');
                    if (listEl) listEl.innerHTML = safeHtml;
                } else {
                    if (emptyEl) emptyEl.style.display = 'flex';
                }
            } else {
                if (listEl) listEl.innerHTML = '<span style="color:#ef4444;">Failed to generate insights.</span>';
            }
        } catch(e) {
            console.error('Failed to load AI Insights', e);
            aiInsightsLoading = false;
            if (loadingEl) loadingEl.style.display = 'none';
            if (listEl) listEl.innerHTML = '<span style="color:#ef4444;">Connection error.</span>';
        }
    }

    const refreshBtn = document.getElementById('aiSuggestionsRefresh');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            loadAIInsights();
        });
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
                            <div style="display:flex; align-items:center; gap:0.5rem;">
                                <span class="entry-time">${dateStr} • ${timeStr}</span>
                                <div class="fb-post-options">
                                    <button class="fb-post-options-toggle" onclick="window.togglePostOptions(${entry.id})">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:18px;height:18px;">
                                            <path stroke-linecap="round" stroke-linejoin="round" d="M12 6.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 12.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 18.75a.75.75 0 110-1.5.75.75 0 010 1.5z" />
                                        </svg>
                                    </button>
                                    <div id="postOptions_${entry.id}" class="fb-post-options-dropdown">
                                        <button class="fb-post-options-btn" onclick="window.editTimelineEntry(${entry.id}); window.togglePostOptions(${entry.id})">Edit Entry</button>
                                        <button class="fb-post-options-btn danger" onclick="window.confirmDeleteTimelineEntry(${entry.id}); window.togglePostOptions(${entry.id})">Delete Entry</button>
                                    </div>
                                </div>
                            </div>
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
                        </div>

                        <!-- Action Bar for Entry -->
                        <div class="fb-post-actions">
                            <button class="fb-post-action-btn ${entry.user_reaction === 1 ? 'active' : ''}" onclick="window.reactToEntry(${entry.id})">
                                <svg viewBox="0 0 24 24" fill="${entry.user_reaction === 1 ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.5" style="width:18px;height:18px;">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.514" />
                                </svg>
                                Like ${entry.likes_count > 0 ? `(${entry.likes_count})` : ''}
                            </button>
                            <button class="fb-post-action-btn" onclick="window.togglePostComments(${entry.id})">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:18px;height:18px;">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 20.25c4.97 0 9-3.694 9-8.25s-4.03-8.25-9-8.25S3 7.444 3 12c0 2.104.859 4.023 2.273 5.48.432.447.74 1.04.586 1.641a4.483 4.483 0 01-.923 1.785A5.969 5.969 0 006 21c1.282 0 2.47-.402 3.445-1.087.81.22 1.668.337 2.555.337z" />
                                </svg>
                                Thread ${entry.comments && entry.comments.length > 0 ? `(${entry.comments.length})` : ''}
                            </button>
                        </div>

                        <!-- Comments Section (Hidden by default) -->
                        <div id="postComments_${entry.id}" class="fb-post-comments" style="display:none; margin-top: 0.5rem; padding-top: 0.5rem;">
                            <div id="commentsList_${entry.id}" style="display:flex; flex-direction:column; margin-bottom: 0.75rem;">
                                ${renderCommentsHtml(entry.comments, entry.id)}
                            </div>
                            <div style="display:flex; gap:0.5rem; align-items:flex-start;">
                                <div class="fb-avatar" style="margin-top:2px;">You</div>
                                <div style="flex:1; display:flex; flex-direction:column; gap:4px;">
                                    <input type="text" id="commentInput_${entry.id}" placeholder="Start a thread..." onkeydown="if(event.key === 'Enter') window.addTimelineComment(${entry.id})" style="padding: 0.5rem 0.75rem; border-radius: 12px; border: 1px solid var(--color-surface-high); background: var(--color-surface-lowest); font-size: 13px; color: var(--color-on-surface); width:100%; outline: none;" autocomplete="off">
                                </div>
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
            
            const view = link.dataset.view;
            if (view === 'graph') {
                timelineContainer.style.display = 'none';
                document.getElementById('graphWrapper').style.display = 'flex';
                document.querySelector('.timeline-header').style.display = 'none';
                
                // Expand grid to take the full width of screen
                const sidebar = document.querySelector('.analytics-sidebar');
                if (sidebar) sidebar.style.display = 'none';
                const canvas = document.querySelector('.timeline-canvas');
                if (canvas) canvas.style.gridColumn = 'span 12';
                
                // Set default side panel stats
                document.getElementById('gnTotalNodes').innerText = allEntries.length;
                document.getElementById('gnTotalDecisions').innerText = allEntries.filter(e => e.entry_type === 'decision').length;
                document.getElementById('gnTotalMilestones').innerText = allEntries.filter(e => e.entry_type === 'milestone').length;
                document.getElementById('gnDefault').style.display = 'block';
                document.getElementById('gnSelected').style.display = 'none';
                
                initECharts(allEntries);
            } else {
                timelineContainer.style.display = 'flex'; // it defaults to block/flex based on css
                document.getElementById('graphWrapper').style.display = 'none';
                document.querySelector('.timeline-header').style.display = 'flex';
                
                // Restore standard timeline grid layout
                const sidebar = document.querySelector('.analytics-sidebar');
                if (sidebar) sidebar.style.display = 'flex'; // It uses flex layout
                const canvas = document.querySelector('.timeline-canvas');
                if (canvas) canvas.style.gridColumn = ''; // Reverts to CSS default (span 8)
                
                currentFilter = link.dataset.filter || 'all';
                applyFiltersAndRender();
            }
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

    document.getElementById('gnClearBtn')?.addEventListener('click', () => {
        document.getElementById('gnSelected').style.display = 'none';
        document.getElementById('gnDefault').style.display = 'block';
    });

    sortBox.addEventListener('change', applyFiltersAndRender);
    impactChecks.forEach(cb => cb.addEventListener('change', applyFiltersAndRender));
    filterCollab.addEventListener('input', applyFiltersAndRender);
    filterTags.addEventListener('input', applyFiltersAndRender);

    // --- EDIT & DELETE & COMMENTS ---
    
    function renderCommentsHtml(comments, entryId) {
        if (!comments || comments.length === 0) return '';
        
        let html = '';
        
        // Group by parent_id
        const topLevel = comments.filter(c => !c.parent_id);
        const children = comments.filter(c => c.parent_id);
        
        const renderCommentBlock = (c, isReply = false) => {
            const replies = children.filter(child => child.parent_id === c.id);
            const dateStr = new Date(c.created_at).toLocaleDateString();
            
            const likeActive = c.user_reaction === 1 ? 'active' : '';
            
            let replyHtml = '';
            let replyToggle = '';
            if (replies.length > 0) {
                replyToggle = `
                <div style="margin-left:0; margin-top:4px;">
                    <button class="show-more-toggle" onclick="window.toggleReplies(${c.id})">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:14px;height:14px;"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>
                        <span id="replyToggleText_${c.id}">View ${replies.length} replies in thread</span>
                    </button>
                </div>`;
                
                replyHtml = `<div id="replies_${c.id}" style="display:none; flex-direction:column;">` + 
                            replies.map(r => renderCommentBlock(r, true)).join('') + 
                            `</div>`;
            }
            
            const wrapperClass = isReply ? 'fb-comment-reply-row' : '';
            const authorInitials = c.author_name ? c.author_name.substring(0,1).toUpperCase() : 'U';
            
            return `
                <div class="${wrapperClass} fb-comment-row">
                    <div class="fb-avatar">${authorInitials}</div>
                    <div class="fb-comment-body">
                        <div class="fb-comment-bubble">
                            <div class="fb-comment-author">${escapeHtml(c.author_name)}</div>
                            <div class="fb-comment-text">${escapeHtml(c.content)}</div>
                            ${c.likes_count > 0 ? `
                            <div class="fb-likes-count">
                                <span>👍</span> ${c.likes_count}
                            </div>
                            ` : ''}
                        </div>
                        
                        <div class="fb-comment-actions">
                            <button class="fb-action-btn ${likeActive}" onclick="window.reactToComment(${c.id}, true)">Like</button>
                            ${!isReply ? `
                            <button class="fb-action-btn" onclick="window.toggleReplyBox(${c.id})">Reply</button>
                            ` : ''}
                            <button class="fb-action-btn" style="color:#ef4444;" onclick="window.deleteTimelineComment(${c.id})">Delete</button>
                            <span class="fb-comment-date">${dateStr}</span>
                        </div>
                        
                        <div id="replyBox_${c.id}" class="reply-input-row" style="margin-top:8px;">
                            <div class="fb-avatar" style="width:24px; height:24px; font-size:10px;">You</div>
                            <input type="text" id="replyInput_${c.id}" placeholder="Reply to thread..." onkeydown="if(event.key === 'Enter') window.addTimelineComment(${entryId}, ${c.id})" style="flex:1; padding: 0.4rem 0.75rem; border-radius: 12px; border: 1px solid var(--color-surface-high); background: var(--color-surface-lowest); font-size: 13px; color: var(--color-on-surface); outline: none;" autocomplete="off">
                        </div>

                        ${replyToggle}
                        ${replyHtml}
                    </div>
                </div>
            `;
        };
        
        let visibleComments = topLevel;
        let hiddenCommentsHtml = '';
        let toggleCommentsHtml = '';
        
        if (topLevel.length > 1) {
            visibleComments = topLevel.slice(0, 1);
            const hiddenComments = topLevel.slice(1);
            
            hiddenCommentsHtml = `
            <div id="hiddenComments_${entryId}" style="display:none; flex-direction:column;">
                ${hiddenComments.map(c => renderCommentBlock(c)).join('')}
            </div>
            `;
            
            toggleCommentsHtml = `
            <button id="toggleCommentsBtn_${entryId}" class="show-more-toggle" style="margin-top:8px; margin-bottom:12px;" onclick="window.toggleHiddenComments(${entryId})">
                <svg viewBox="0 0 24 24" fill="none" class="w-4 h-4 mr-1" stroke="currentColor" stroke-width="1.5" style="width:14px;height:14px;"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg> 
                View ${hiddenComments.length} more threads
            </button>
            `;
        }
        
        const visibleHtml = visibleComments.map(c => renderCommentBlock(c)).join('');
        return visibleHtml + hiddenCommentsHtml + toggleCommentsHtml;
    }
    
    window.togglePostOptions = function(entryId) {
        const doc = document.getElementById(`postOptions_${entryId}`);
        if(doc) doc.classList.toggle('active');
    };

    window.togglePostComments = function(entryId) {
        const doc = document.getElementById(`postComments_${entryId}`);
        if(doc) {
            doc.style.display = doc.style.display === 'none' ? 'block' : 'none';
        }
    };
    
    window.reactToEntry = async function(entryId) {
        if (!currentTeamId) return;
        try {
            const res = await mFetch(`/api/v1/timeline/${entryId}/react`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ is_like: true })
            });
            if (res.ok) fetchTimeline(currentTeamId, currentSubteamId);
        } catch(e) { console.error('Entry reaction failed:', e); }
    };
    
    window.toggleHiddenComments = function(entryId) {
        const div = document.getElementById(`hiddenComments_${entryId}`);
        const btn = document.getElementById(`toggleCommentsBtn_${entryId}`);
        if(div && btn) {
            if(div.style.display === 'none') {
                div.style.display = 'flex';
                btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" class="w-4 h-4 mr-1" stroke="currentColor" stroke-width="1.5" style="width:14px;height:14px;"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" /></svg> Hide threads`;
            } else {
                div.style.display = 'none';
                const count = div.children.length; // Approximate top level
                btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" class="w-4 h-4 mr-1" stroke="currentColor" stroke-width="1.5" style="width:14px;height:14px;"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg> View ${count} more threads`;
            }
        }
    };
    
    window.toggleReplies = function(commentId) {
        const div = document.getElementById(`replies_${commentId}`);
        const textSpan = document.getElementById(`replyToggleText_${commentId}`);
        if (div && textSpan) {
            if (div.style.display === 'none') {
                div.style.display = 'flex';
                textSpan.innerText = 'Hide replies';
            } else {
                div.style.display = 'none';
                textSpan.innerText = `View ${div.children.length}  replies`;
            }
        }
    };
    
    window.deleteTimelineComment = async function(commentId) {
        if (!confirm("Are you sure you want to delete this comment?")) return;
        try {
            const res = await mFetch(`/api/v1/timeline/comments/${commentId}`, { method: 'DELETE', headers });
            if (res.ok) {
                if (currentTeamId) {
                    fetchTimeline(currentTeamId, currentSubteamId);
                }
            } else {
                if (res.status === 403) {
                    alert("Permission denied. You can only delete your own comments.");
                } else {
                    alert("Failed to delete comment.");
                }
            }
        } catch (e) {
            console.error("Delete failed:", e);
        }
    };

    window.toggleReplyBox = function(commentId) {
        const box = document.getElementById(`replyBox_${commentId}`);
        if (box) {
            box.classList.toggle('active');
            if(box.classList.contains('active')) {
                const input = document.getElementById(`replyInput_${commentId}`);
                if(input) input.focus();
            }
        }
    };
    
    window.reactToComment = async function(commentId, isLike) {
        if (!currentTeamId) return;
        try {
            const res = await mFetch(`/api/v1/timeline/comments/${commentId}/react`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ is_like: isLike })
            });
            if (res.ok) {
                // silently refresh the view to update UI
                fetchTimeline(currentTeamId, currentSubteamId);
            }
        } catch(e) {
            console.error('Reaction failed:', e);
        }
    };

    window.addTimelineComment = async function(entryId, parentId = null) {
        const inputId = parentId ? `replyInput_${parentId}` : `commentInput_${entryId}`;
        const input = document.getElementById(inputId);
        if (!input) return;
        const text = input.value.trim();
        if (!text) return;
        
        input.disabled = true;
        try {
            const res = await mFetch(`/api/v1/timeline/${entryId}/comments`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ content: text, parent_id: parentId })
            });
            if (res.ok) {
                // Reload timeline to display newly added comment
                if (currentTeamId) {
                    loadTeamData(currentTeamId, currentSubteamId);
                }
            } else {
                showError("Failed to add comment.");
                input.disabled = false;
            }
        } catch(e) {
            console.error(e);
            showError("Network error adding comment.");
            input.disabled = false;
        }
    };

    window.confirmDeleteTimelineEntry = function(id) {
        entryToDelete = id;
        deleteConfirmModal.classList.add('active');
    };

    cancelDeleteBtn.addEventListener('click', () => {
        deleteConfirmModal.classList.remove('active');
        entryToDelete = null;
    });

    confirmDeleteBtn.addEventListener('click', async () => {
        if (!entryToDelete || !currentTeamId) return;
        
        confirmDeleteBtn.textContent = "Deleting...";
        try {
            const res = await mFetch(`/api/v1/timeline/${entryToDelete}`, {
                method: 'DELETE',
                headers
            });
            if (res.ok) {
                loadTeamData(currentTeamId);
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

        editingEntrySubteamId = entry.sub_team_id || null;
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
        if (currentSubteamId === 'all') {
            showError('Select a team in the sidebar before adding a memory entry.');
            return;
        }
        editEntryId.value = "";
        editingEntrySubteamId = null;
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
        if (!currentTeamId) return alert('No project selected.');

        const isEditing = !!editEntryId.value;
        const url = isEditing ? `/api/v1/timeline/${editEntryId.value}` : '/api/v1/timeline/';
        const method = isEditing ? 'PUT' : 'POST';

        if (!isEditing && currentSubteamId === 'all') {
            showError('Select a team in the sidebar before adding a memory entry.');
            return;
        }

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
            payload.team_id = currentTeamId;
            payload.sub_team_id = parseInt(currentSubteamId, 10);
        } else if (editingEntrySubteamId) {
            payload.sub_team_id = editingEntrySubteamId;
        }

        const originalText = saveEntryBtn.textContent;
        saveEntryBtn.textContent = isEditing ? 'Updating...' : 'Saving...';
        saveEntryBtn.disabled = true;

        try {
            const res = await mFetch(url, {
                method: method,
                headers,
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                entryModal.classList.remove('active');
                entryForm.reset();
                editEntryId.value = "";
                loadTeamData(currentTeamId);
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
    fetchTeams();

    // React to sidebar team switch
    const _teamSel = document.getElementById('teamSelect');
    if (_teamSel) {
        _teamSel.addEventListener('change', function () {
            localStorage.setItem('selected_team_id', _teamSel.value);
            fetchTeams();
        });
    }

    setInterval(() => {
        if(currentTeamId) {
            fetchTimeline(currentTeamId, currentSubteamId); // silently updates and triggers dot
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

    // Update subtitle on subteam change
    window.addEventListener('subteamchange', (e) => {
        const { id, name } = e.detail || {};
        currentSubteamId = id || 'all';
        currentSubteamName = name || 'All Teams';
        updateScopeHeader();
        updateCreateControls();
        if (currentTeamId) {
            loadTeamData(currentTeamId, currentSubteamId);
        }
    });

    window.addEventListener('teamchange', (e) => {
        const { id, name } = e.detail || {};
        const parsedTeamId = parseInt(id, 10);
        if (!Number.isNaN(parsedTeamId)) {
            currentTeamId = parsedTeamId;
        }
        if (projectTitle) {
            projectTitle.textContent = name || 'Project Memory';
        }
        currentSubteamId = 'all';
        currentSubteamName = 'All Teams';
        updateScopeHeader();
        updateCreateControls();
        if (currentTeamId) {
            loadTeamData(currentTeamId, 'all');
        }
    });

    // --- ECHARTS (Network Graph) ---
    let graphChart = null;
    function initECharts(entries) {
        if (entries.length === 0) return;
        if (!graphChart) {
            graphChart = echarts.init(document.getElementById('graphContainer'));
            window.addEventListener('resize', () => graphChart && graphChart.resize());
        }
        
        const nodes = [];
        const links = [];
        
        // Render nodes
        entries.forEach(e => {
            let color = '#94a3b8';
            if (e.entry_type === 'decision') color = '#ec4899';
            else if (e.entry_type === 'milestone') color = '#8b5cf6';
            else if (e.entry_type === 'upload') color = '#10b981';

            nodes.push({
                id: 'node_' + e.id,
                name: e.title,
                value: e.entry_type,
                itemStyle: { color: color },
                symbolSize: (e.impact_level === 'critical' || e.impact_level === 'high') ? 30 : 20,
                entryData: e
            });
        });

        // Create logical branching timelines by connecting to the immediate predecessor
        const sortedEntries = [...entries].sort((a,b) => new Date(a.created_at) - new Date(b.created_at));
        
        sortedEntries.forEach((e, idx) => {
            if (e.tags) {
                const myTags = e.tags.split(',').map(t=>t.trim().toLowerCase());
                // Look backwards to attach to the most recent parent
                for (let i = idx - 1; i >= 0; i--) {
                    const other = sortedEntries[i];
                    if (other.tags) {
                        const otherTags = other.tags.split(',').map(t=>t.trim().toLowerCase());
                        if (myTags.some(mt => otherTags.includes(mt))) {
                            links.push({
                                source: 'node_' + other.id,
                                target: 'node_' + e.id,
                                lineStyle: { opacity: 0.6, width: 2, curveness: 0.2 }
                            });
                            break; // Attach to immediate parent only to form a branch
                        }
                    }
                }
            }
        });

        const option = {
            title: { text: "", left: "center", top: 10, textStyle: { color: "#334155" } },
            tooltip: {
                formatter: function (params) {
                    if (params.dataType === 'node') {
                        return `<b>${escapeHtml(params.data.name)}</b><br/>Type: ${params.data.value}`;
                    }
                    return '';
                }
            },
            series: [{
                type: 'graph',
                layout: 'force',
                edgeSymbol: ['none', 'arrow'],
                edgeSymbolSize: [4, 8],
                data: nodes,
                links: links,
                roam: true,
                label: { show: true, position: 'right', formatter: '{b}', textStyle: { color: "#64748b" } },
                force: { repulsion: 400, edgeLength: 150 } // Increased spacing for readability
            }]
        };
        graphChart.setOption(option);
        
        // Single listener to prevent multiple unbind bindings
        graphChart.off('click');
        graphChart.on('click', function(params) {
            if (params.dataType === 'node' && params.data.entryData) {
                const e = params.data.entryData;
                const detailsPanel = document.getElementById('graphNodeDetails');
                
                document.getElementById('gnDefault').style.display = 'none';
                document.getElementById('gnSelected').style.display = 'flex';
                
                // Trigger a resize on the chart to recompute boundaries
                setTimeout(() => {
                    if (graphChart) graphChart.resize();
                }, 50);
                
                document.getElementById('gnType').innerText = e.entry_type;
                document.getElementById('gnTitle').innerText = e.title;
                document.getElementById('gnDate').innerText = new Date(e.created_at).toLocaleDateString();
                document.getElementById('gnAuthor').innerText = e.author_name || 'System';
                document.getElementById('gnContent').innerText = e.content || 'No details provided.';
                
                let tagsHtml = '';
                if (e.tags) {
                    tagsHtml = e.tags.split(',').map(t => `<span class="tag-pill" style="display:inline-block; margin:0 0.25rem 0.25rem 0; padding:0.25rem 0.5rem; background:var(--color-surface-high); border-radius:0.5rem; font-size:0.7rem;">${escapeHtml(t.trim())}</span>`).join('');
                }
                document.getElementById('gnTags').innerHTML = tagsHtml;
            }
        });
    }

    // --- APEXCHARTS (Velocity Matrix) ---
    let velocityChartObj = null;
    function initApexCharts(entries) {
        if (!entries || entries.length === 0) return;
        
        const groups = {};
        entries.forEach(e => {
            const d = new Date(e.created_at);
            const k = d.toLocaleString('default', { month: 'short', year:'2-digit' });
            if(!groups[k]) groups[k] = { decisions: 0, milestones: 0, uploads: 0 };
            if(e.entry_type === 'decision') groups[k].decisions++;
            if(e.entry_type === 'milestone') groups[k].milestones++;
        });

        const categories = Object.keys(groups).reverse();
        const dataD = categories.map(k => groups[k].decisions);
        const dataM = categories.map(k => groups[k].milestones);

        const options = {
            series: [
                { name: 'Decisions', data: dataD },
                { name: 'Milestones', data: dataM }
            ],
            chart: { type: 'area', height: 220, toolbar: { show: false }, background: 'transparent' },
            colors: ['#ec4899', '#8b5cf6'],
            fill: { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.4, opacityTo: 0.05, stops: [0, 90, 100] } },
            dataLabels: { enabled: false },
            stroke: { curve: 'smooth', width: 2 },
            xaxis: { categories: categories },
            legend: { position: 'top', horizontalAlign: 'right' }
        };

        if (velocityChartObj) {
            velocityChartObj.updateOptions({ xaxis: { categories } });
            velocityChartObj.updateSeries(options.series);
        } else {
            velocityChartObj = new ApexCharts(document.querySelector("#velocityChart"), options);
            velocityChartObj.render();
        }
    }


    // --- CONFLICT CHECKING (Live in Modal) ---
    let conflictTimer = null;
    const entryContentInput = document.getElementById('entryContent');
    const conflictWarning = document.getElementById('conflictWarning');
    const conflictText = document.getElementById('conflictText');

    entryContentInput?.addEventListener('input', () => {
        clearTimeout(conflictTimer);
        conflictWarning.style.display = 'none';
        const text = entryContentInput.value.trim();
        if (text.length > 25 && currentTeamId) {
            conflictTimer = setTimeout(async () => {
                try {
                    const res = await mFetch(`/api/v1/timeline/team/${currentTeamId}/check-conflict`, {
                        method: 'POST',
                        headers,
                        body: JSON.stringify({text})
                    });
                    if(res.ok) {
                        const data = await res.json();
                        if(data.warnings && data.warnings.length > 0) {
                            conflictText.textContent = data.warnings[0];
                            conflictWarning.style.display = 'block';
                        }
                    }
                } catch(e) {}
            }, 1500);
        }
    });

});
