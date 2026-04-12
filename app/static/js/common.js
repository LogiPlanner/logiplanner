/* ═══════════════════════════════════════════════════════════════
   LogiPlanner — Shared Base Script
   Runs on every page that extends base.html.
   ═══════════════════════════════════════════════════════════════ */

(function () {

    // ── Token helpers ──
    function forceLogout() {
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        sessionStorage.removeItem('lp_pending_setup');
        window.location.href = '/login';
    }

    async function tryRefresh() {
        const rt = localStorage.getItem('refresh_token');
        if (!rt) return false;
        try {
            const res = await fetch('/api/v1/refresh', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refresh_token: rt }),
            });
            if (!res.ok) return false;
            const data = await res.json();
            localStorage.setItem('access_token', data.access_token);
            localStorage.setItem('refresh_token', data.refresh_token);
            return true;
        } catch { return false; }
    }

    /** Fetch with automatic token refresh on 401. */
    async function authFetch(url, opts = {}) {
        const token = localStorage.getItem('access_token');
        if (!opts.headers) opts.headers = {};
        if (token) opts.headers['Authorization'] = 'Bearer ' + token;

        let res = await fetch(url, opts);
        if (res.status === 401) {
            const ok = await tryRefresh();
            if (ok) {
                opts.headers['Authorization'] = 'Bearer ' + localStorage.getItem('access_token');
                res = await fetch(url, opts);
            } else {
                forceLogout();
                return res;
            }
        }
        return res;
    }

    // Expose globally for page scripts
    window.__lp = { authFetch, forceLogout };

    // ── Auth Guard: promote token from URL param ──
    const urlParams = new URLSearchParams(window.location.search);
    const urlToken = urlParams.get('token');
    const urlRefresh = urlParams.get('refresh_token');
    if (urlToken) {
        localStorage.setItem('access_token', urlToken);
        if (urlRefresh) localStorage.setItem('refresh_token', urlRefresh);
        window.history.replaceState({}, document.title, window.location.pathname);
    }

    const token = localStorage.getItem('access_token');
    if (!token) {
        window.location.href = '/login';
        return;
    }

    // ── Logout ──
    document.getElementById('navbarLogoutBtn')?.addEventListener('click', () => forceLogout());
    document.getElementById('logoutBtn')?.addEventListener('click', () => forceLogout());

    // ── Create Project (navbar) ──
    document.getElementById('navCreateProjectBtn')?.addEventListener('click', function() {
        window.location.href = '/settings?section=create-project';
    });

    // ── Mobile Sidebar Toggle ──
    const toggle  = document.getElementById('mobileToggle');
    const sidebar = document.getElementById('mainSidebar');
    const overlay = document.getElementById('sidebarOverlay');

    if (toggle && sidebar) {
        toggle.addEventListener('click', () => {
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

    // ── Team colors palette ──
    var _teamColors = ['#4f46e5','#7c3aed','#06d6a0','#f59e0b','#ef4444','#3b82f6','#ec4899','#14b8a6'];

    // ── Hidden team select (kept for page-script compat) ──
    var _ts = document.getElementById('teamSelect');

    // ── Notification bell toggle ──
    var _notifBtn = document.getElementById('notifBtn');
    var _notifDropdown = document.getElementById('notifDropdown');
    if (_notifBtn && _notifDropdown) {
        _notifBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            var open = _notifDropdown.style.display !== 'none';
            _notifDropdown.style.display = open ? 'none' : 'block';
        });
        document.addEventListener('click', function(e) {
            if (!_notifDropdown.contains(e.target) && e.target !== _notifBtn) {
                _notifDropdown.style.display = 'none';
            }
        });
    }

    // ── User Avatar dropdown toggle ──
    var _avatarBtn = document.getElementById('userAvatarBtn');
    var _userDropdown = document.getElementById('userDropdown');
    if (_avatarBtn && _userDropdown) {
        _avatarBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            var isVisible = _userDropdown.style.opacity === '1' || _userDropdown.style.visibility === 'visible';
            if (isVisible) {
                _userDropdown.style.opacity = '0';
                _userDropdown.style.visibility = 'hidden';
                _userDropdown.style.transform = 'translateY(-8px)';
            } else {
                _userDropdown.style.opacity = '1';
                _userDropdown.style.visibility = 'visible';
                _userDropdown.style.transform = 'translateY(0)';
            }
        });
        document.addEventListener('click', function(e) {
            if (!_avatarBtn.contains(e.target)) {
                _userDropdown.style.opacity = '0';
                _userDropdown.style.visibility = 'hidden';
                _userDropdown.style.transform = 'translateY(-8px)';
            }
        });
    }

    // ── Subteam dropdown toggle ──
    var _subteamBtn  = document.getElementById('subteamDropdownBtn');
    var _subteamMenu = document.getElementById('subteamMenu');
    if (_subteamBtn && _subteamMenu) {
        _subteamBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            var open = _subteamMenu.style.display !== 'none';
            _subteamMenu.style.display = open ? 'none' : 'block';
        });
        document.addEventListener('click', function(e) {
            if (!_subteamBtn.contains(e.target) && !_subteamMenu.contains(e.target)) {
                _subteamMenu.style.display = 'none';
            }
        });
    }

    // ── Render Projects list in navbar dropdown (teams = UI "projects") ──
    function _renderNavProjects(teams) {
        var container = document.getElementById('navProjectsList');
        if (!container) return;
        var selectedId = parseInt(localStorage.getItem('selected_team_id') || '0');
        container.innerHTML = '';
        teams.forEach(function(t, i) {
            var id = t.id || t.team_id;
            var name = t.team_name || t.name || 'Project';
            var color = _teamColors[i % _teamColors.length];
            var btn = document.createElement('button');
            btn.className = 'topbar__project-btn' + (id === selectedId ? ' active' : '');
            btn.dataset.teamId = id;
            btn.innerHTML = '<span class="topbar__project-dot" style="background:' + color + '"></span>' + _escHtml(name);
            btn.addEventListener('click', function() {
                localStorage.setItem('selected_team_id', id);
                localStorage.removeItem('selected_subteam_id');
                // Update hidden select for page-script compat
                if (_ts) {
                    for (var j = 0; j < _ts.options.length; j++) {
                        if (parseInt(_ts.options[j].value) === id) {
                            _ts.selectedIndex = j;
                            _ts.dispatchEvent(new Event('change'));
                            break;
                        }
                    }
                }
                // Close dropdown and reload page to reflect new project
                if (_userDropdown) {
                    _userDropdown.style.opacity = '0';
                    _userDropdown.style.visibility = 'hidden';
                }
                _renderNavProjects(teams);
                if (!_ts) {
                    window.dispatchEvent(new CustomEvent('teamchange', { detail: { id: id, name: name } }));
                }
            });
            container.appendChild(btn);
        });
    }

    // ── Render SubTeam options in sidebar dropdown (subteams = UI "teams") ──
    function _renderSubteamOpts(subteams) {
        if (!_subteamMenu) return;
        var selectedId = localStorage.getItem('selected_subteam_id') || 'all';
        _subteamMenu.innerHTML = '';

        // "All Teams" option
        var allBtn = document.createElement('button');
        allBtn.className = 'sidebar__subteam-opt' + (selectedId === 'all' ? ' active' : '');
        allBtn.dataset.subteamId = 'all';
        allBtn.innerHTML = '<span class="sidebar__subteam-dot" style="background:#9ca3af"></span>All Teams';
        allBtn.addEventListener('click', function() {
            _selectSubteam('all', 'All Teams');
        });
        _subteamMenu.appendChild(allBtn);

        subteams.forEach(function(st, i) {
            var color = st.color || _teamColors[i % _teamColors.length];
            var btn = document.createElement('button');
            btn.className = 'sidebar__subteam-opt' + (parseInt(selectedId) === st.id ? ' active' : '');
            btn.dataset.subteamId = st.id;
            btn.innerHTML = '<span class="sidebar__subteam-dot" style="background:' + _escHtml(color) + '"></span>' + _escHtml(st.name);
            btn.addEventListener('click', function() {
                _selectSubteam(st.id, st.name);
            });
            _subteamMenu.appendChild(btn);
        });
    }

    function _selectSubteam(id, name) {
        localStorage.setItem('selected_subteam_id', id);
        var nameEl = document.getElementById('activeSubteamName');
        if (nameEl) nameEl.textContent = name;
        if (_subteamMenu) _subteamMenu.style.display = 'none';
        // Update active states
        if (_subteamMenu) {
            _subteamMenu.querySelectorAll('.sidebar__subteam-opt').forEach(function(b) {
                b.classList.toggle('active', String(b.dataset.subteamId) === String(id));
            });
        }
        window.dispatchEvent(new CustomEvent('subteamchange', { detail: { id: id, name: name } }));
    }

    // ── Load subteams for current team ──
    function _loadSubteams(teamId) {
        if (!teamId || !_subteamMenu) return;
        authFetch('/api/v1/settings/teams/' + teamId + '/subteams')
            .then(function(r) { return r && r.ok ? r.json() : null; })
            .then(function(data) {
                _renderSubteamOpts(data && data.subteams ? data.subteams : []);
                // Restore saved subteam name
                var savedId = localStorage.getItem('selected_subteam_id') || 'all';
                var nameEl = document.getElementById('activeSubteamName');
                if (nameEl) {
                    if (savedId === 'all') {
                        nameEl.textContent = 'All Teams';
                    } else if (data && data.subteams) {
                        var found = data.subteams.find(function(s) { return String(s.id) === String(savedId); });
                        if (found) nameEl.textContent = found.name;
                    }
                }
            })
            .catch(function() {});
    }

    function _escHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // ── Load user info → set initials + dropdown name/email ──
    authFetch('/api/v1/profile-status')
        .then(function(r) { return r && r.ok ? r.json() : null; })
        .then(function(d) {
            if (!d) return;
            var name = d.full_name || '';
            var email = d.email || '';
            var displayName = name || email;
            var initials = displayName.trim().split(/\s+/).slice(0, 2).map(function(p) { return p[0].toUpperCase(); }).join('') || 'U';
            var avatarEl = document.getElementById('avatarInitials');
            if (avatarEl) avatarEl.textContent = initials;
            var nameEl = document.getElementById('navUserName');
            if (nameEl) nameEl.textContent = name || email || 'User';
            var emailEl = document.getElementById('navUserEmail');
            if (emailEl) {
                emailEl.textContent = email;
                emailEl.style.display = email ? '' : 'none';
            }
        })
        .catch(function() {});

    // ── Load teams → populate navbar projects + sidebar subteams ──
    authFetch('/api/v1/onboarding/my-teams')
        .then(function(r) { return r && r.ok ? r.json() : null; })
        .then(function(data) {
            if (!data || !data.teams || data.teams.length === 0) return;

            var teams = data.teams;
            var saved = localStorage.getItem('selected_team_id');
            var selectedTeamId = saved ? parseInt(saved) : null;

            // Auto-select first team if none saved
            if (!selectedTeamId && teams.length > 0) {
                selectedTeamId = teams[0].id || teams[0].team_id;
                localStorage.setItem('selected_team_id', selectedTeamId);
            }

            // Populate hidden select (page-script compat)
            if (_ts) {
                if (_ts.options.length <= 1 && _ts.options[0] && _ts.options[0].textContent.includes('Loading')) {
                    _ts.innerHTML = '';
                    teams.forEach(function(t) {
                        var opt = document.createElement('option');
                        opt.value = t.id || t.team_id;
                        opt.textContent = t.team_name || t.name;
                        if (parseInt(opt.value) === selectedTeamId) opt.selected = true;
                        _ts.appendChild(opt);
                    });
                    if (!_ts.value) _ts.selectedIndex = 0;
                }
                _ts.addEventListener('change', function() {
                    localStorage.setItem('selected_team_id', _ts.value);
                    _loadSubteams(_ts.value);
                    window.dispatchEvent(new CustomEvent('teamchange', { detail: { id: _ts.value, name: _ts.options[_ts.selectedIndex] ? _ts.options[_ts.selectedIndex].textContent : '' } }));
                });
            }

            // Render navbar project list
            _renderNavProjects(teams);

            // Load subteams for currently selected team
            _loadSubteams(selectedTeamId);
        })
        .catch(function() {});

})();

/* ═══════════════════════════════════════════════════════════════
   VOICE RECORDER — Shared FAB widget
   Call: window.__lp.initVoiceRecorder({ teamId, fetchNotes, onDone, timeoutMsg })
   ═══════════════════════════════════════════════════════════════ */
(function () {
    if (!window.__lp) window.__lp = {};

    window.__lp.initVoiceRecorder = function (cfg) {
        var _teamId = cfg.teamId;
        var _fetchNotes = cfg.fetchNotes;       // () => Promise<Array>
        var _onDone = cfg.onDone || function () {};
        var _timeoutMsg = cfg.timeoutMsg || 'Still processing — check back shortly.';

        var voiceFab = document.getElementById('voiceFab');
        var voicePanel = document.getElementById('voicePanel');
        var voicePanelClose = document.getElementById('voicePanelClose');
        var voiceStartBtn = document.getElementById('voiceStartBtn');
        var voiceStopBtn = document.getElementById('voiceStopBtn');
        var voiceCancelBtn = document.getElementById('voiceCancelBtn');
        var voicePauseBtn = document.getElementById('voicePauseBtn');
        var voiceNewRecording = document.getElementById('voiceNewRecording');
        var voiceRetryBtn = document.getElementById('voiceRetryBtn');
        var voiceTimer = document.getElementById('voiceTimer');
        var voiceWaveformCanvas = document.getElementById('voiceWaveformCanvas');
        var voiceProgressBar = document.getElementById('voiceProgressBar');
        var voiceProcessingLabel = document.getElementById('voiceProcessingLabel');
        var voiceErrorText = document.getElementById('voiceErrorText');
        var voicePauseIcon = document.getElementById('voicePauseIcon');
        var voiceResumeIcon = document.getElementById('voiceResumeIcon');
        var voiceUploadBtn = document.getElementById('voiceUploadBtn');
        var voiceFileInput = document.getElementById('voiceFileInput');

        if (!voiceFab) return;

        var panelOpen = false;
        var mediaRecorder = null;
        var audioChunks = [];
        var isRecording = false;
        var isPaused = false;
        var recordingStartTime = 0;
        var recordingElapsed = 0;
        var timerInterval = null;
        var audioContext = null;
        var analyser = null;
        var animationFrame = null;

        // ── Panel open / close ──
        voiceFab.addEventListener('click', function () {
            if (isRecording) { stopRecording(); return; }
            panelOpen = !panelOpen;
            voicePanel.classList.toggle('voice-panel--open', panelOpen);
        });

        voicePanelClose.addEventListener('click', function () {
            if (isRecording) cancelRecording();
            closePanel();
        });

        function closePanel() {
            panelOpen = false;
            voicePanel.classList.remove('voice-panel--open');
            voiceFab.classList.remove('voice-fab--hidden');
        }

        function showState(stateId) {
            ['voiceStateIdle', 'voiceStateRecording', 'voiceStateProcessing', 'voiceStateDone', 'voiceStateError']
                .forEach(function (id) {
                    var el = document.getElementById(id);
                    if (el) el.style.display = (id === stateId) ? 'flex' : 'none';
                });
        }

        // ── Timer ──
        function startTimer() {
            recordingStartTime = Date.now();
            recordingElapsed = 0;
            timerInterval = setInterval(updateTimerDisplay, 100);
        }

        function updateTimerDisplay() {
            var now = isPaused ? recordingElapsed : recordingElapsed + (Date.now() - recordingStartTime);
            var totalSec = Math.floor(now / 1000);
            var min = String(Math.floor(totalSec / 60)).padStart(2, '0');
            var sec = String(totalSec % 60).padStart(2, '0');
            voiceTimer.textContent = min + ':' + sec;
        }

        function stopTimer() { clearInterval(timerInterval); }

        // ── Waveform visualization ──
        function startWaveform(stream) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            analyser = audioContext.createAnalyser();
            analyser.fftSize = 256;
            var source = audioContext.createMediaStreamSource(stream);
            source.connect(analyser);

            var ctx = voiceWaveformCanvas.getContext('2d');
            var bufferLength = analyser.frequencyBinCount;
            var dataArray = new Uint8Array(bufferLength);
            var W = voiceWaveformCanvas.width;
            var H = voiceWaveformCanvas.height;

            function draw() {
                animationFrame = requestAnimationFrame(draw);
                analyser.getByteFrequencyData(dataArray);
                ctx.clearRect(0, 0, W, H);
                var barCount = 40, gap = 3;
                var barWidth = (W - gap * (barCount - 1)) / barCount;
                var step = Math.floor(bufferLength / barCount);
                for (var i = 0; i < barCount; i++) {
                    var val = dataArray[i * step] / 255;
                    var barH = Math.max(3, val * H * 0.85);
                    var x = i * (barWidth + gap);
                    var y = (H - barH) / 2;
                    var t = i / barCount;
                    var r = Math.round(99 + t * 40);
                    var g = Math.round(102 - t * 10);
                    var b = Math.round(241 + t * 5);
                    ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + b + ',' + (0.6 + val * 0.4) + ')';
                    ctx.beginPath();
                    ctx.roundRect(x, y, barWidth, barH, 2);
                    ctx.fill();
                }
            }
            draw();
        }

        function stopWaveform() {
            if (animationFrame) cancelAnimationFrame(animationFrame);
            if (audioContext && audioContext.state !== 'closed') audioContext.close().catch(function () {});
            audioContext = null;
            analyser = null;
        }

        // ── Upload audio file ──
        if (voiceUploadBtn && voiceFileInput) {
            voiceUploadBtn.addEventListener('click', function () {
                if (!_teamId) {
                    showVoiceError('No project selected. Please select a team first.');
                    return;
                }
                voiceFileInput.click();
            });

            voiceFileInput.addEventListener('change', function () {
                var file = voiceFileInput.files && voiceFileInput.files[0];
                if (!file) return;
                voiceFileInput.value = '';
                showState('voiceStateProcessing');
                voiceProcessingLabel.textContent = 'Uploading audio...';
                voiceProgressBar.style.width = '0%';
                uploadRecording(file, file.name);
            });
        }

        // ── Start recording ──
        voiceStartBtn.addEventListener('click', startRecording);

        function startRecording() {
            if (!_teamId) {
                showVoiceError('No project selected. Please select a team first.');
                return;
            }
            navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
                var mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
                    ? 'audio/webm;codecs=opus'
                    : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';

                mediaRecorder = mimeType
                    ? new MediaRecorder(stream, { mimeType: mimeType })
                    : new MediaRecorder(stream);

                audioChunks = [];

                mediaRecorder.ondataavailable = function (e) {
                    if (e.data.size > 0) audioChunks.push(e.data);
                };

                mediaRecorder.onstop = function () {
                    var mimeUsed = mediaRecorder.mimeType || 'audio/webm';
                    var ext = mimeUsed.includes('mp4') ? '.mp4' : '.webm';
                    var blob = new Blob(audioChunks, { type: mimeUsed });
                    audioChunks = [];
                    stream.getTracks().forEach(function (t) { t.stop(); });
                    stopWaveform();
                    uploadRecording(blob, 'meeting_recording' + ext);
                };

                mediaRecorder.start(250);
                isRecording = true;
                isPaused = false;

                showState('voiceStateRecording');
                voiceFab.classList.add('voice-fab--recording');
                voiceFab.querySelector('.voice-fab__label').textContent = 'Stop';
                startTimer();
                startWaveform(stream);
            }).catch(function () {
                showVoiceError('Microphone access denied. Please allow microphone permissions and try again.');
            });
        }

        // ── Stop recording ──
        voiceStopBtn.addEventListener('click', stopRecording);

        function stopRecording() {
            if (!mediaRecorder || mediaRecorder.state === 'inactive') return;
            isRecording = false;
            isPaused = false;
            stopTimer();
            mediaRecorder.stop();
            voiceFab.classList.remove('voice-fab--recording');
            voiceFab.querySelector('.voice-fab__label').textContent = 'Record';
            showState('voiceStateProcessing');
            voiceProcessingLabel.textContent = 'Uploading audio...';
            voiceProgressBar.style.width = '0%';
        }

        // ── Cancel recording ──
        voiceCancelBtn.addEventListener('click', cancelRecording);

        function cancelRecording() {
            if (mediaRecorder && mediaRecorder.state !== 'inactive') {
                mediaRecorder.onstop = function () {
                    if (mediaRecorder.stream) mediaRecorder.stream.getTracks().forEach(function (t) { t.stop(); });
                };
                mediaRecorder.stop();
            }
            isRecording = false;
            isPaused = false;
            audioChunks = [];
            stopTimer();
            stopWaveform();
            voiceFab.classList.remove('voice-fab--recording');
            voiceFab.querySelector('.voice-fab__label').textContent = 'Record';
            voiceTimer.textContent = '00:00';
            showState('voiceStateIdle');
        }

        // ── Pause / Resume ──
        voicePauseBtn.addEventListener('click', function () {
            if (!mediaRecorder) return;
            if (isPaused) {
                mediaRecorder.resume();
                isPaused = false;
                recordingStartTime = Date.now();
                timerInterval = setInterval(updateTimerDisplay, 100);
                voicePauseIcon.style.display = '';
                voiceResumeIcon.style.display = 'none';
            } else {
                mediaRecorder.pause();
                isPaused = true;
                recordingElapsed += Date.now() - recordingStartTime;
                clearInterval(timerInterval);
                voicePauseIcon.style.display = 'none';
                voiceResumeIcon.style.display = '';
            }
        });

        // ── Upload recording ──
        function uploadRecording(blob, filename) {
            voiceProgressBar.style.width = '10%';
            voiceProcessingLabel.textContent = 'Uploading audio...';

            var formData = new FormData();
            formData.append('team_id', _teamId);
            formData.append('file', blob, filename);

            var xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/v1/meetings/upload-audio', true);

            var tkn = localStorage.getItem('access_token');
            if (tkn) xhr.setRequestHeader('Authorization', 'Bearer ' + tkn);

            xhr.upload.onprogress = function (e) {
                if (e.lengthComputable) {
                    var pct = Math.round((e.loaded / e.total) * 60);
                    voiceProgressBar.style.width = pct + '%';
                }
            };

            xhr.onload = function () {
                if (xhr.status === 200) {
                    voiceProgressBar.style.width = '65%';
                    voiceProcessingLabel.textContent = 'AI is transcribing & summarizing...';
                    pollForCompletion();
                } else {
                    var detail = 'Upload failed.';
                    try { detail = JSON.parse(xhr.responseText).detail || detail; } catch (_) {}
                    showVoiceError(detail);
                }
            };

            xhr.onerror = function () { showVoiceError('Network error. Check your connection.'); };
            xhr.send(formData);
        }

        // ── Poll for AI processing completion ──
        function pollForCompletion() {
            var baseline = null;
            var pollCount = 0;
            var maxPolls = 30;
            var interval = 2000;

            _fetchNotes()
                .then(function (notes) { baseline = Array.isArray(notes) ? notes.length : 0; })
                .catch(function () { baseline = 0; });

            var timer = setInterval(function () {
                pollCount++;
                var fakePct = Math.min(95, 65 + (pollCount / maxPolls) * 30);
                voiceProgressBar.style.width = fakePct + '%';
                if (baseline === null) return;

                _fetchNotes().then(function (notes) {
                    if (Array.isArray(notes) && notes.length > baseline) {
                        clearInterval(timer);
                        voiceProgressBar.style.width = '100%';
                        setTimeout(function () { showState('voiceStateDone'); }, 400);
                        _onDone();
                    }
                }).catch(function () {});

                if (pollCount >= maxPolls) {
                    clearInterval(timer);
                    voiceProgressBar.style.width = '100%';
                    voiceProcessingLabel.textContent = _timeoutMsg;
                    setTimeout(function () { showState('voiceStateDone'); _onDone(); }, 1500);
                }
            }, interval);
        }

        // ── Error handling ──
        function showVoiceError(msg) {
            voiceErrorText.textContent = msg;
            showState('voiceStateError');
            voiceFab.classList.remove('voice-fab--recording');
            voiceFab.querySelector('.voice-fab__label').textContent = 'Record';
        }

        // ── Retry / New recording ──
        voiceRetryBtn.addEventListener('click', function () {
            voiceTimer.textContent = '00:00';
            showState('voiceStateIdle');
        });

        voiceNewRecording.addEventListener('click', function () {
            voiceTimer.textContent = '00:00';
            showState('voiceStateIdle');
        });

        // ── Close panel on click outside ──
        document.addEventListener('click', function (e) {
            if (!panelOpen) return;
            var recorder = document.getElementById('voiceRecorder');
            if (recorder && !recorder.contains(e.target)) {
                if (!isRecording) closePanel();
            }
        });

        // Return closePanel for page-specific button handlers
        return { closePanel: closePanel };
    };
})();
