document.addEventListener('DOMContentLoaded', () => {
    const token = localStorage.getItem('access_token');
    if (!token) { window.location.href = '/login'; return; }

    const headers = {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
    };

    const projectSelect = document.getElementById('projectSelect');
    const timelineContainer = document.getElementById('timelineContainer');
    const timelineEmpty = document.getElementById('timelineEmpty');
    
    // Modal
    const addEntryBtn = document.getElementById('addEntryBtn');
    const cancelEntryBtn = document.getElementById('cancelEntryBtn');
    const entryModal = document.getElementById('entryModal');
    const entryForm = document.getElementById('entryForm');

    async function fetchProjects() {
        try {
            const res = await fetch('/api/v1/timeline/projects', { headers });
            if (res.ok) {
                const projects = await res.json();
                if (projects.length > 0) {
                    projectSelect.innerHTML = projects.map(p => `<option value="${p.id}">${p.project_name}</option>`).join('');
                    fetchTimeline(projects[0].id);
                } else {
                    projectSelect.innerHTML = '<option>No Projects Found</option>';
                    timelineEmpty.style.display = 'block';
                    timelineEmpty.innerHTML = '<div class="timeline-empty__icon">⚠️</div><div class="timeline-empty__text">You need to join or create a team first.</div>';
                }
            } else if (res.status === 401) {
                window.location.href = '/login';
            }
        } catch(e) {
            console.error('Failed to fetch projects', e);
        }
    }

    async function fetchTimeline(projectId) {
        try {
            const res = await fetch(`/api/v1/timeline/project/${projectId}`, { headers });
            if (res.ok) {
                const entries = await res.json();
                renderTimeline(entries);
            }
        } catch(e) {
            console.error('Failed to fetch timeline', e);
        }
    }

    function renderTimeline(entries) {
        // remove existing entries
        document.querySelectorAll('.timeline-entry').forEach(e => e.remove());
        
        if (entries.length === 0) {
            timelineEmpty.style.display = 'block';
            return;
        }
        
        timelineEmpty.style.display = 'none';
        
        const html = entries.map(entry => {
            const date = new Date(entry.created_at).toLocaleString();
            let sourceHtml = '';
            if (entry.source_reference) {
                sourceHtml = `<a href="${escapeHtml(entry.source_reference)}" target="_blank" class="timeline-entry__source">
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style="width:14px;height:14px"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>
                    Source
                </a>`;
            }

            return `
                <div class="timeline-entry timeline-entry--${entry.entry_type}">
                    <div class="timeline-entry__dot"></div>
                    <div class="timeline-entry__card">
                        <div class="timeline-entry__header">
                            <h4 class="timeline-entry__title">${escapeHtml(entry.title)}</h4>
                            <div class="timeline-entry__meta">
                                <span class="timeline-badge timeline-badge--${entry.entry_type}">${entry.entry_type}</span>
                                <span class="timeline-entry__time">${date}</span>
                            </div>
                        </div>
                        <p class="timeline-entry__content">${escapeHtml(entry.content)}</p>
                        ${sourceHtml}
                    </div>
                </div>
            `;
        }).join('');
        
        // Insert right after the empty state node
        timelineEmpty.insertAdjacentHTML('afterend', html);
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

    // Event Listeners
    projectSelect.addEventListener('change', (e) => {
        const id = e.target.value;
        if (id && !isNaN(id)) fetchTimeline(id);
    });

    addEntryBtn.addEventListener('click', () => {
        entryModal.classList.add('active');
    });

    cancelEntryBtn.addEventListener('click', () => {
        entryModal.classList.remove('active');
        entryForm.reset();
    });

    entryForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const projectId = projectSelect.value;
        if (!projectId || isNaN(projectId)) return alert('No project selected to attach this entry to.');

        const payload = {
            project_id: parseInt(projectId),
            entry_type: document.getElementById('entryType').value,
            title: document.getElementById('entryTitle').value,
            content: document.getElementById('entryContent').value,
            source_reference: document.getElementById('entrySource').value || null
        };

        const btn = document.getElementById('saveEntryBtn');
        const originalText = btn.textContent;
        btn.textContent = 'Saving...';
        btn.disabled = true;

        try {
            const res = await fetch('/api/v1/timeline/', {
                method: 'POST',
                headers,
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                entryModal.classList.remove('active');
                entryForm.reset();
                fetchTimeline(projectId);
            } else {
                const data = await res.json();
                alert(data.detail || 'Error saving entry');
            }
        } catch(err) {
            console.error(err);
            alert('A network error occurred.');
        } finally {
            btn.textContent = originalText;
            btn.disabled = false;
        }
    });

    // Init
    fetchProjects();
});
