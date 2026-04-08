document.addEventListener('DOMContentLoaded', () => {
    let teamId = document.getElementById('currentTeamId')?.value;
    if (teamId === 'None' || !teamId) {
        teamId = localStorage.getItem('selected_team_id');
    }
    if (!teamId || teamId === 'None') {
        showToast("No team ID found. Please select a project.", "error");
        return;
    }
    
    // Switch to common authFetch
    const fetch = window.__lp ? window.__lp.authFetch : window.fetch;

    /* -------------------------------------------------------------------------- */
    /*                               Toast Utility                              */
    /* -------------------------------------------------------------------------- */
    function showToast(message, type = "success") {
        const container = document.getElementById('toastContainer');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        container.appendChild(toast);
        
        // initial small delay to allow dom insertion then fade in
        setTimeout(() => toast.style.opacity = '1', 10);
        
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    /* -------------------------------------------------------------------------- */
    /*                               UI Modals                                  */
    /* -------------------------------------------------------------------------- */
    function showConfirmDelete(message) {
        return new Promise((resolve) => {
            const modal = document.getElementById('confirmModal');
            if(!modal) return resolve(window.confirm(message));
            
            document.getElementById('confirmMessage').innerText = message;
            modal.style.display = 'flex';
            
            const okBtn = document.getElementById('confirmOkBtn');
            const cancelBtn = document.getElementById('confirmCancelBtn');
            
            const newOk = okBtn.cloneNode(true);
            const newCancel = cancelBtn.cloneNode(true);
            okBtn.parentNode.replaceChild(newOk, okBtn);
            cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);
            
            newOk.addEventListener('click', () => {
                modal.style.display = 'none';
                resolve(true);
            });
            newCancel.addEventListener('click', () => {
                modal.style.display = 'none';
                resolve(false);
            });
        });
    }

    /* -------------------------------------------------------------------------- */
    /*                                Tabs & Layout                             */
    /* -------------------------------------------------------------------------- */
    const tabWhiteboard = document.getElementById('tabWhiteboard');
    const tabEditor = document.getElementById('tabEditor');
    const tabHistory = document.getElementById('tabHistory');
    const notesModal = document.getElementById('notesModal');
    const historySidebar = document.getElementById('historySidebar');

    tabWhiteboard.addEventListener('click', () => {
        tabWhiteboard.classList.add('active');
        tabEditor.classList.remove('active');
        notesModal.style.display = 'none';
        historySidebar.classList.remove('open');
    });

    tabEditor.addEventListener('click', () => {
        tabEditor.classList.add('active');
        tabWhiteboard.classList.remove('active');
        notesModal.style.display = 'flex';
        historySidebar.classList.remove('open');
    });

    document.getElementById('closeNotesModal').addEventListener('click', () => {
        tabWhiteboard.click();
    });

    tabHistory.addEventListener('click', () => {
        historySidebar.classList.toggle('open');
        if(historySidebar.classList.contains('open')) {
            loadHistory();
        }
    });

    /* -------------------------------------------------------------------------- */
    /*                         Search & Notifications                           */
    /* -------------------------------------------------------------------------- */
    const searchInput = document.querySelector('.search-input');
    if (searchInput) {
        searchInput.addEventListener('keyup', (e) => {
            const query = e.target.value.toLowerCase();
            const noteEls = document.querySelectorAll('#notesList > div');
            noteEls.forEach(el => {
                const textSpan = el.querySelector('span'); // The actual note title is in a span now
                const text = textSpan ? textSpan.innerText.toLowerCase() : el.innerText.toLowerCase();
                if (text.includes(query)) {
                    el.style.display = 'flex';
                } else {
                    el.style.display = 'none';
                }
            });
        });
    }

    const notificationBtn = document.getElementById('notificationBtn');
    if (notificationBtn) {
        notificationBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const popup = document.getElementById('notificationsPopup');
            popup.style.display = popup.style.display === 'none' ? 'flex' : 'none';
        });
        document.addEventListener('click', (e) => {
            if (!e.target.closest('#notificationDropdownWrapper')) {
                const popup = document.getElementById('notificationsPopup');
                if(popup) popup.style.display = 'none';
            }
        });
    }

    /* -------------------------------------------------------------------------- */
    /*                        Draggable Notes Modal                             */
    /* -------------------------------------------------------------------------- */
    let isDragging = false;
    let dragStartX, dragStartY;
    let initialX, initialY;
    const headerEl = document.getElementById('notesModalHeader');
    
    headerEl.addEventListener('mousedown', (e) => {
        // Prevent drag on buttons inside header
        if (e.target.closest('button') || e.target.closest('svg')) return;
        isDragging = true;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        initialX = notesModal.offsetLeft;
        initialY = notesModal.offsetTop;
        document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const dx = e.clientX - dragStartX;
        const dy = e.clientY - dragStartY;
        notesModal.style.left = `${initialX + dx}px`;
        notesModal.style.top = `${initialY + dy}px`;
    });

    document.addEventListener('mouseup', () => {
        isDragging = false;
        document.body.style.userSelect = '';
    });


    /* -------------------------------------------------------------------------- */
    /*                            Whiteboard & Fabric.js                        */
    /* -------------------------------------------------------------------------- */
    const whiteboardContainer = document.getElementById('whiteboardContainer');
    const canvasEl = document.getElementById('whiteboardCanvas');
    canvasEl.width = whiteboardContainer.clientWidth - 70;
    canvasEl.height = whiteboardContainer.clientHeight;
    
    const canvas = new fabric.Canvas('whiteboardCanvas', {
        isDrawingMode: false,
        selection: true,
        fireRightClick: true,
        stopContextMenu: true
    });

    // Handle Resize
    window.addEventListener('resize', () => {
        canvas.setWidth(whiteboardContainer.clientWidth - 70);
        canvas.setHeight(whiteboardContainer.clientHeight);
    });

    // Zoom Controls
    let currentZoom = 1;
    const zoomLevelText = document.getElementById('zoomLevelText');
    
    function setZoom(zoom) {
        currentZoom = Math.max(0.1, Math.min(zoom, 5)); // cap between 10% and 500%
        canvas.setZoom(currentZoom);
        zoomLevelText.innerText = Math.round(currentZoom * 100) + '%';
        
        // Sync CSS grid size with zoom
        const bgSize = 24 * currentZoom;
        whiteboardContainer.style.backgroundSize = `${bgSize}px ${bgSize}px`;
    }

    document.getElementById('zoomIn').addEventListener('click', () => setZoom(currentZoom + 0.1));
    document.getElementById('zoomOut').addEventListener('click', () => setZoom(currentZoom - 0.1));

    // Export Dropdown & Logic
    const exportBtn = document.getElementById('exportBoardBtn');
    const exportPopup = document.getElementById('exportPopup');
    if (exportBtn && exportPopup) {
        exportBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            exportPopup.style.display = exportPopup.style.display === 'none' ? 'flex' : 'none';
        });
        document.addEventListener('click', (e) => {
            if (!e.target.closest('#exportDropdownWrapper')) {
                exportPopup.style.display = 'none';
            }
        });
        
        document.querySelectorAll('#exportPopup .tool-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const format = e.currentTarget.getAttribute('data-export');
                exportPopup.style.display = 'none';
                if (!canvas) return;

                const oldBg = canvas.backgroundColor;
                if (format === 'jpeg') {
                     canvas.backgroundColor = '#ffffff';
                     canvas.renderAll();
                }

                try {
                    let dataUrl;
                    if (format === 'svg') {
                        dataUrl = 'data:image/svg+xml;utf8,' + encodeURIComponent(canvas.toSVG());
                    } else {
                        dataUrl = canvas.toDataURL({
                            format: format,
                            quality: 1,
                            multiplier: 2 // High Resolution
                        });
                    }

                    const link = document.createElement('a');
                    link.download = `LogiPlanner_Board_${new Date().getTime()}.${format}`;
                    link.href = dataUrl;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                } catch (err) {
                    console.error("Export failed:", err);
                    showToast("Export failed. Complex external images might block the operation.", "error");
                } finally {
                    if (format === 'jpeg') {
                         canvas.backgroundColor = oldBg;
                         canvas.renderAll();
                    }
                }
            });
        });
    }

    // Canvas panning via alt+drag
    canvas.on('mouse:down', function (opt) {
        let evt = opt.e;
        if (evt.altKey === true) {
            this.isDraggingCanvas = true;
            this.selection = false;
            this.lastPosX = evt.clientX;
            this.lastPosY = evt.clientY;
        }
    });
    canvas.on('mouse:move', function (opt) {
        if (this.isDraggingCanvas) {
            let e = opt.e;
            let vpt = this.viewportTransform;
            vpt[4] += e.clientX - this.lastPosX;
            vpt[5] += e.clientY - this.lastPosY;
            this.requestRenderAll();
            this.lastPosX = e.clientX;
            this.lastPosY = e.clientY;
            
            // Sync background grid position
            whiteboardContainer.style.backgroundPosition = `${vpt[4]}px ${vpt[5]}px`;
        }
    });
    canvas.on('mouse:up', function () {
        this.setViewportTransform(this.viewportTransform);
        this.isDraggingCanvas = false;
        this.selection = true;
    });

    // Toolbar logic
    const tools = document.querySelectorAll('.tool-btn:not(.shape-option-btn):not(#boardColorPicker)');
    const shapeOptions = document.querySelectorAll('.shape-option-btn');
    const shapesPopup = document.getElementById('shapesPopup');
    const colorPicker = document.getElementById('boardColorPicker');
    let pendingTextMode = false;
    let isEraserMode = false;

    if(colorPicker) {
        colorPicker.addEventListener('change', (e) => {
            if (canvas.isDrawingMode && !isEraserMode) {
                canvas.freeDrawingBrush.color = e.target.value;
            }
            if (canvas.getActiveObject() && canvas.getActiveObject().type === 'i-text') {
                canvas.getActiveObject().set('fill', e.target.value);
                canvas.requestRenderAll();
                saveBoardState();
            }
        });
    }

    // Toggle shape popup menu
    document.getElementById('shapeMenuBtn').addEventListener('click', (e) => {
        // Only toggle and prevent normal tool assignment
        shapesPopup.style.display = shapesPopup.style.display === 'none' ? 'flex' : 'none';
        e.stopPropagation();
    });

    // Close popup if clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#shapeMenuContainer')) {
            shapesPopup.style.display = 'none';
        }
    });

    // Shape specific selections
    shapeOptions.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const shapeType = btn.getAttribute('data-shape');
            handleToolChange('shape_insert', shapeType);
            shapesPopup.style.display = 'none'; // close popup
        });
    });

    tools.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const tool = btn.getAttribute('data-tool');
            if(tool === 'shape_menu') return; // Handled above
            if(tool === 'uploadImage') {
                document.getElementById('boardImageUpload').click();
                return; // don't make upload active
            }

            tools.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            handleToolChange(tool);
        });
    });

    function handleToolChange(tool, modifier = null) {
        canvas.isDrawingMode = false;
        pendingTextMode = false;
        isEraserMode = false;

        const currentColor = colorPicker ? colorPicker.value : '#000000';

        if (tool === 'draw') {
            canvas.isDrawingMode = true;
            canvas.freeDrawingBrush.color = currentColor;
            canvas.freeDrawingBrush.width = 3;
        } else if (tool === 'eraser') {
            isEraserMode = true;
            showToast("Eraser Mode: Click or drag over objects to delete them", "success");
        } else if (tool === 'sticky') {
            const rect = new fabric.Rect({
                left: 0, top: 0, fill: '#fef3c7', width: 160, height: 160, rx: 8, ry: 8,
                shadow: new fabric.Shadow({ color: 'rgba(0,0,0,0.1)', blur: 10, offsetY: 4 })
            });
            const text = new fabric.IText('New Note', {
                left: 15, top: 15, fontFamily: 'sans-serif', fontSize: 16, fill: currentColor
            });
            const group = new fabric.Group([rect, text], {
                left: 100, top: 100
            });
            canvas.add(group);
            canvas.setActiveObject(group);
            saveBoardState();
            revertToSelect();
        } else if (tool === 'shape_insert') {
            let shapeObj;
            if (modifier === 'rect') {
                shapeObj = new fabric.Rect({
                    left: 150, top: 150, fill: 'transparent', stroke: currentColor, strokeWidth: 3, width: 100, height: 100
                });
            } else if (modifier === 'circle') {
                shapeObj = new fabric.Circle({
                    left: 150, top: 150, fill: 'transparent', stroke: currentColor, strokeWidth: 3, radius: 50
                });
            } else if (modifier === 'triangle') {
                shapeObj = new fabric.Triangle({
                    left: 150, top: 150, fill: 'transparent', stroke: currentColor, strokeWidth: 3, width: 100, height: 100
                });
            } else if (modifier === 'line') {
                shapeObj = new fabric.Line([50, 150, 200, 150], {
                    left: 150, top: 150, stroke: currentColor, strokeWidth: 3
                });
            }
            if (shapeObj) {
                canvas.add(shapeObj);
                canvas.setActiveObject(shapeObj);
                saveBoardState();
            }
            revertToSelect();
        } else if (tool === 'text') {
            pendingTextMode = true;
            showToast("Click anywhere to add text", "success");
        } else if (tool === 'select') {
            // default mode
        }
    }

    function revertToSelect() {
        tools.forEach(b => b.classList.remove('active'));
        document.querySelector('.tool-btn[data-tool="select"]').classList.add('active');
        canvas.isDrawingMode = false;
        pendingTextMode = false;
    }

    // Disable canvas native context menu to allow custom right-clicks
    document.querySelector('.canvas-container').addEventListener('contextmenu', e => e.preventDefault());

    const contextMenu = document.getElementById('canvasContextMenu');
    let contextMenuTarget = null;
    let copiedObject = null;

    canvas.on('mouse:down', (options) => {
        // Right click context menu
        if(options.e.button === 2) {
            contextMenuTarget = options.target || null;
            if(contextMenuTarget) {
                canvas.setActiveObject(contextMenuTarget);
                document.getElementById('menuCopy').style.display = 'block';
                document.getElementById('menuFront').style.display = 'block';
                document.getElementById('menuBack').style.display = 'block';
                document.getElementById('menuDelete').style.display = 'block';
            } else {
                document.getElementById('menuCopy').style.display = 'none';
                document.getElementById('menuFront').style.display = 'none';
                document.getElementById('menuBack').style.display = 'none';
                document.getElementById('menuDelete').style.display = 'none';
            }
            
            document.getElementById('menuPaste').style.display = copiedObject ? 'block' : 'none';
            
            if(contextMenuTarget || copiedObject) {
                contextMenu.style.display = 'block';
                contextMenu.style.left = `${options.e.clientX}px`;
                contextMenu.style.top = `${options.e.clientY}px`;
            } else {
                if(contextMenu) contextMenu.style.display = 'none';
            }
            return;
        } else {
            if(contextMenu) contextMenu.style.display = 'none';
        }

        // Eraser Object Removal
        if(isEraserMode && options.target) {
            canvas.remove(options.target);
            canvas.discardActiveObject();
            saveBoardState();
            return;
        }

        if (pendingTextMode) {
            const pointer = canvas.getPointer(options.e);
            const currentColor = colorPicker ? colorPicker.value : '#000000';
            const text = new fabric.IText('Text...', {
                left: pointer.x,
                top: pointer.y,
                fontFamily: 'sans-serif',
                fontSize: 20,
                fill: currentColor
            });
            canvas.add(text);
            canvas.setActiveObject(text);
            text.enterEditing();
            text.selectAll();
            revertToSelect();
            saveBoardState();
        }
    });

    canvas.on('mouse:move', (options) => {
        // Eraser Object Removal while dragging
        if(isEraserMode && options.target && options.e.buttons === 1) {
            canvas.remove(options.target);
            canvas.discardActiveObject();
            saveBoardState();
        }
    });

    if (contextMenu) {
        document.getElementById('menuCopy').addEventListener('click', () => {
            if (!contextMenuTarget) return;
            contextMenuTarget.clone((cloned) => {
                copiedObject = cloned;
            });
            contextMenu.style.display = 'none';
        });

        document.getElementById('menuPaste').addEventListener('click', () => {
            if (!copiedObject) return;
            copiedObject.clone((clonedObj) => {
                canvas.discardActiveObject();
                clonedObj.set({
                    left: clonedObj.left + 20,
                    top: clonedObj.top + 20,
                    evented: true,
                });
                if (clonedObj.type === 'activeSelection') {
                    clonedObj.canvas = canvas;
                    clonedObj.forEachObject(function(obj) {
                        canvas.add(obj);
                    });
                    clonedObj.setCoords();
                } else {
                    canvas.add(clonedObj);
                }
                copiedObject.top += 20;
                copiedObject.left += 20;
                canvas.setActiveObject(clonedObj);
                canvas.requestRenderAll();
                saveBoardState();
            });
            contextMenu.style.display = 'none';
        });

        document.getElementById('menuFront').addEventListener('click', () => {
            if (contextMenuTarget) {
                canvas.bringToFront(contextMenuTarget);
                saveBoardState();
                canvas.requestRenderAll();
            }
            contextMenu.style.display = 'none';
        });

        document.getElementById('menuBack').addEventListener('click', () => {
            if (contextMenuTarget) {
                canvas.sendToBack(contextMenuTarget);
                saveBoardState();
                canvas.requestRenderAll();
            }
            contextMenu.style.display = 'none';
        });

        document.getElementById('menuDelete').addEventListener('click', () => {
            if (contextMenuTarget) {
                canvas.remove(contextMenuTarget);
                canvas.discardActiveObject();
                saveBoardState();
            }
            contextMenu.style.display = 'none';
        });

        // Close right click menu if left click outside
        document.addEventListener('click', (e) => {
            if (e.button !== 2 && !e.target.closest('#canvasContextMenu')) {
                contextMenu.style.display = 'none';
            }
        });

        canvas.on('mouse:wheel', () => contextMenu.style.display = 'none');
    }

    // File Upload to Board
    document.getElementById('boardImageUpload').addEventListener('change', function(e) {
        const file = e.target.files[0];
        if(!file) return;
        const reader = new FileReader();
        reader.onload = function(f) {
            const data = f.target.result;
            fabric.Image.fromURL(data, function(img) {
                img.scaleToWidth(300);
                canvas.add(img).centerObject(img).setActiveObject(img);
                saveBoardState();
            });
        };
        reader.readAsDataURL(file);
        e.target.value = ''; // reset
    });

    // Keybindings (Delete object)
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Delete' || e.key === 'Backspace') {
            // Prevent deleting if editing text object or inside quill/inputs
            if(document.activeElement.tagName === 'INPUT' || document.activeElement.classList.contains('ql-editor')) return;
            if(canvas.getActiveObject() && !canvas.getActiveObject().isEditing) {
                const activeObjects = canvas.getActiveObjects();
                activeObjects.forEach(obj => canvas.remove(obj));
                canvas.discardActiveObject();
                saveBoardState();
            }
        }
    });

    /* -------------------------------------------------------------------------- */
    /*                               WebSockets                                 */
    /* -------------------------------------------------------------------------- */
    let mySessionId = 'client-' + Math.random().toString(36).substr(2, 9);
    let myFullName = "Team Member";
    
    // Fetch profile status securely to get user's real name
    fetch('/api/v1/profile-status')
        .then(res => res.json())
        .then(data => {
            if(data.full_name) myFullName = data.full_name;
            // UPDATE HEADER AVATAR
            const avatarContainer = document.getElementById('userAvatar');
            const initialsSpan = document.getElementById('avatarInitials');
            if(avatarContainer && initialsSpan) {
                if(data.avatar) {
                    initialsSpan.outerHTML = `<img src="${data.avatar}" alt="Avatar" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">`;
                } else if(data.full_name) {
                    initialsSpan.textContent = data.full_name.charAt(0).toUpperCase();
                }
            }
        }).catch(e => console.error("Could not load user name for cursors"));

    let wsUrl = (window.location.protocol === 'https:' ? 'wss://' : 'ws://') + window.location.host + '/api/v1/meetings/ws/' + teamId;
    let ws = new WebSocket(wsUrl);
    let ignoreNextChange = false;

    // Real-time Presence
    const activeUsers = {};
    function trackPresence(sessionId, fullName) {
        if(!activeUsers[sessionId]) {
            activeUsers[sessionId] = { name: fullName || "Guest", lastSeen: Date.now() };
            renderActiveUsers();
        } else {
             if(activeUsers[sessionId].name !== fullName && fullName) {
                 activeUsers[sessionId].name = fullName;
                 renderActiveUsers();
             }
             activeUsers[sessionId].lastSeen = Date.now();
        }
    }
    
    // Pruning inactive users
    setInterval(() => {
        let changed = false;
        const now = Date.now();
        for (const id in activeUsers) {
            if (now - activeUsers[id].lastSeen > 8000) { // 8 seconds timeout
                delete activeUsers[id];
                changed = true;
            }
        }
        if(changed) renderActiveUsers();
    }, 4000);
    
    // Self presence broadcast
    setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'presence', session_id: mySessionId, full_name: myFullName }));
        }
    }, 3000);
    
    function renderActiveUsers() {
        const container = document.getElementById('activeUsersList');
        if(!container) return;
        
        const users = Object.values(activeUsers);
        let html = '';
        
        users.forEach((u, idx) => {
            if(idx < 4) {
                const initial = u.name.charAt(0).toUpperCase();
                html += `<div style="width: 32px; height: 32px; border-radius: 50%; background: #10b981; color: white; display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 600; border: 2px solid white; margin-left: ${idx > 0 ? '-10px' : '0'}; z-index: ${10-idx};" title="${u.name}">${initial}</div>`;
            }
        });
        
        if(users.length > 4) {
            html += `<span class="avatar-more" style="z-index: 1;">+${users.length - 4}</span>`;
        }
        
        if (users.length === 0) {
            html = '<span style="font-size:12px; color:#9ca3af; margin-right:8px;">Only you</span>';
        }
        
        container.innerHTML = html;
    }


    // Helper: Ensure UUID
    function ensureObjectId(obj) {
        if (obj.id) return obj.id;

        const cryptoObj = window.crypto || window.msCrypto;

        if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
            obj.id = 'obj-' + cryptoObj.randomUUID();
            return obj.id;
        }

        if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
            const bytes = new Uint8Array(16);
            cryptoObj.getRandomValues(bytes);

            bytes[6] = (bytes[6] & 0x0f) | 0x40;
            bytes[8] = (bytes[8] & 0x3f) | 0x80;

            const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
            const uuid = [
                hex.slice(0, 4).join(''),
                hex.slice(4, 6).join(''),
                hex.slice(6, 8).join(''),
                hex.slice(8, 10).join(''),
                hex.slice(10, 16).join('')
            ].join('-');

            obj.id = 'obj-' + uuid;
            return obj.id;
        }

        obj.id = 'obj-' + Math.random().toString(36).substr(2, 9);
        return obj.id;
    }

    ws.onmessage = function(event) {
        const msg = JSON.parse(event.data);
        
        if(msg.session_id && msg.session_id !== mySessionId) {
            trackPresence(msg.session_id, msg.full_name);
        }
        
        // Initial Board Load
        if (msg.type === 'init' && msg.data) {
            ignoreNextChange = true;
            canvas.loadFromJSON(msg.data, () => {
                canvas.backgroundColor = null;
                canvas.renderAll();
            });
        } 
        // Sync Deltas
        else if (msg.type === 'object_add') {
            if(msg.session_id === mySessionId) return;
            fabric.util.enlivenObjects([msg.object], function(objects) {
                objects.forEach(function(o) {
                    // Make sure the remote object respects the UUID
                    if(msg.id) o.id = msg.id;
                    ignoreNextChange = true;
                    canvas.add(o);
                });
                canvas.requestRenderAll();
            });
        }
        else if (msg.type === 'object_modify') {
            if(msg.session_id === mySessionId) return;
            const obj = canvas.getObjects().find(o => o.id === msg.id);
            if(obj) {
                ignoreNextChange = true;
                obj.set(msg.object);
                // Specifically update text properties if it's text
                if (obj.type === 'i-text' || obj.type === 'text') {
                    if (msg.object.text) obj.set('text', msg.object.text);
                } else if (obj.type === 'group' && obj._objects) {
                    // For sticky notes - enforce deep sync if nested
                    fabric.util.enlivenObjects([msg.object], function(enlivened) {
                        if (enlivened[0]) {
                           ignoreNextChange = true;
                           canvas.remove(obj);
                           ignoreNextChange = true;
                           enlivened[0].id = msg.id;
                           canvas.add(enlivened[0]);
                           canvas.requestRenderAll();
                        }
                    });
                    return; // Skip normal set
                }
                
                obj.setCoords();
                canvas.requestRenderAll();
            }
        }
        else if (msg.type === 'object_remove') {
            if(msg.session_id === mySessionId) return;
            const obj = canvas.getObjects().find(o => o.id === msg.id);
            if(obj) {
                ignoreNextChange = true;
                canvas.remove(obj);
                canvas.requestRenderAll();
            }
        }
        // Save State (Fallback)
        else if (msg.type === 'save_state' && msg.session_id !== mySessionId) {
            // We NO LONGER wipe and loadFromJSON on save_state to avoid flickering!
            // The backend logs this payload for future clients.
        }
        // Remote Cursors
        else if (msg.type === 'cursor_move') {
            if(msg.session_id !== mySessionId) {
                updateRemoteCursor(msg.session_id, msg.full_name, msg.x, msg.y);
            }
        }
    };

    function broadcastDelta(type, obj) {
        if (ignoreNextChange) {
            ignoreNextChange = false;
            return;
        }
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: type,
                id: obj.id,
                object: typeof obj.toJSON === 'function' ? obj.toJSON(['id']) : obj,
                session_id: mySessionId
            }));
            
            // Also invoke saveBoardState quietly so database is kept up to date
            saveBoardState();
        }
    }

    function saveBoardState() {
        if (ws.readyState === WebSocket.OPEN) {
            // Include explicitly the ID property on all objects for serialization
            const serialized = canvas.toJSON(['id']);
            ws.send(JSON.stringify({
                type: "save_state",
                data: JSON.stringify(serialized),
                session_id: mySessionId
            }));
        }
    }

    // Fabric Event Listeners for Delta Syncing
    canvas.on('object:added', (opt) => {
        if(opt.target) {
            ensureObjectId(opt.target);
            broadcastDelta('object_add', opt.target);
        }
    });

    canvas.on('object:modified', (opt) => {
        if(opt.target) {
            ensureObjectId(opt.target);
            broadcastDelta('object_modify', opt.target);
        }
    });

    canvas.on('text:changed', (opt) => {
        if(opt.target) {
            ensureObjectId(opt.target);
            broadcastDelta('object_modify', opt.target);
        }
    });

    canvas.on('object:removed', (opt) => {
        if(opt.target && opt.target.id) {
            broadcastDelta('object_remove', opt.target);
        }
    });

    // Live Cursors implementation
    let lastCursorSend = 0;
    canvas.on('mouse:move', (opt) => {
        const now = Date.now();
        if(now - lastCursorSend > 40) { // throttle 40ms
            if(ws.readyState === WebSocket.OPEN) {
                const pointer = canvas.getPointer(opt.e);
                ws.send(JSON.stringify({
                    type: 'cursor_move',
                    session_id: mySessionId,
                    full_name: myFullName,
                    x: pointer.x,
                    y: pointer.y
                }));
            }
            lastCursorSend = now;
        }
    });

    const cursors = {};
    function updateRemoteCursor(id, name, x, y) {
        let cursor = cursors[id];
        if(!cursor) {
            cursor = document.createElement('div');
            cursor.className = 'remote-cursor';
            cursor.innerHTML = `
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" style="pointer-events:none;">
                  <path d="M5.5 3.21V20.8L11.4 15.68H18.78L5.5 3.21Z" fill="#ef4444" stroke="white" stroke-width="2"/>
                </svg>
            `;
            const cursorName = document.createElement('div');
            cursorName.className = 'remote-cursor-name';
            cursorName.textContent = name;
            cursor.appendChild(cursorName);
            document.getElementById('whiteboardContainer').appendChild(cursor);
            cursors[id] = cursor;
        }
        
        // Convert canvas absolute coords to screen element coords
        const vpt = canvas.viewportTransform;
        let finalX = (x * vpt[0]) + vpt[4];
        let finalY = (y * vpt[3]) + vpt[5];
        
        cursor.style.left = finalX + 'px';
        cursor.style.top = finalY + 'px';
        
        // Remove cursor after timeout
        clearTimeout(cursor.timeout);
        cursor.timeout = setTimeout(() => {
            cursor.remove();
            delete cursors[id];
        }, 5000); // Expiration: 5s inactive
    }


    /* -------------------------------------------------------------------------- */
    /*                             Quill Editor & Notes                         */
    /* -------------------------------------------------------------------------- */
    const quill = new Quill('#quillEditor', {
        theme: 'snow',
        modules: {
            toolbar: [
                ['bold', 'italic', 'underline', 'strike'],
                ['blockquote', 'code-block'],
                [{ 'header': [1, 2, 3, 4, 5, 6, false] }],
                [{ 'list': 'ordered'}, { 'list': 'bullet' }],
                [{ 'color': [] }, { 'background': [] }],
                [{ 'align': [] }],
                ['clean']
            ]
        }
    });

    let currentFolderId = null;
    let currentNoteId = null;

    function loadFolders() {
        fetch(`/api/v1/meetings/folders/${teamId}`)
            .then(res => {
                if(!res.ok) throw new Error("Database not connected. Please restart your Python Server.");
                return res.json();
            })
            .then(data => {
                const list = document.getElementById('foldersList');
                let allActive = currentFolderId === null ? 'background:#e0e7ff; color:#4f46e5; font-weight:600;' : 'color:#374151;';
                list.replaceChildren();

                const allNotesEl = document.createElement('div');
                allNotesEl.className = 'folder-item';
                allNotesEl.style.cssText = `padding: 8px 12px; margin-bottom: 4px; border-radius: 6px; cursor:pointer; font-size: 13px; ${allActive}`;
                allNotesEl.textContent = 'All Notes';
                allNotesEl.addEventListener('click', () => selectFolder(null));
                list.appendChild(allNotesEl);

                data.forEach(f => {
                    let isActive = currentFolderId === f.id ? 'background:#e0e7ff; color:#4f46e5; font-weight:600;' : 'color:#374151;';

                    const folderEl = document.createElement('div');
                    folderEl.className = 'folder-item';
                    folderEl.style.cssText = `padding: 8px 12px; margin-bottom: 4px; border-radius: 6px; cursor:pointer; font-size: 13px; ${isActive} transition: background 0.2s; display: flex; justify-content: space-between; align-items: center;`;
                    folderEl.addEventListener('click', () => selectFolder(f.id));

                    const nameEl = document.createElement('span');
                    nameEl.style.cssText = 'white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1;';
                    nameEl.title = f.name;
                    nameEl.textContent = f.name;

                    const del = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                    del.setAttribute('class', 'delete-folder-btn');
                    del.dataset.id = f.id;
                    del.setAttribute('viewBox', '0 0 24 24');
                    del.setAttribute('fill', 'none');
                    del.setAttribute('stroke', 'currentColor');
                    del.setAttribute('stroke-width', '2');
                    del.setAttribute('style', 'width:14px; height:14px; color:#ef4444; cursor:pointer; display:none; margin-left:8px;');

                    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                    path.setAttribute('d', 'M3 6h18M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2');
                    del.appendChild(path);

                    folderEl.appendChild(nameEl);
                    folderEl.appendChild(del);
                    list.appendChild(folderEl);

                    folderEl.addEventListener('mouseenter', () => del.style.display = 'block');
                    folderEl.addEventListener('mouseleave', () => del.style.display = 'none');
                    del.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        const confirmed = await showConfirmDelete('Delete this folder and all its notes?');
                        if(confirmed) {
                            fetch(`/api/v1/meetings/folders/${teamId}/${del.dataset.id}`, {method: 'DELETE'})
                            .then(() => {
                                if(currentFolderId == del.dataset.id) selectFolder(null);
                                else loadFolders();
                                showToast("Folder deleted", "success");
                            });
                        }
                    });
                });
            }).catch(e => showToast("Error loading folders", "error"));
    }

    function loadNotes() {
        let url = `/api/v1/meetings/notes/${teamId}`;
        if (currentFolderId) {
            url += `?folder_id=${currentFolderId}`;
        }
        fetch(url)
            .then(async res => {
                if(!res.ok) {
                    const errTxt = await res.text();
                    throw new Error(errTxt || "API failed");
                }
                return res.json();
            })
            .then(data => {
                const list = document.getElementById('notesList');
                list.innerHTML = '';
                if (data.length === 0) {
                    list.innerHTML = '<div style="padding: 12px; font-size:12px; color:#9ca3af; text-align:center;">No notes here yet.</div>';
                    return;
                }
                data.forEach(n => {
                    const el = document.createElement('div');
                    let isActiveStyle = currentNoteId === n.id ? 'background:#e0e7ff; color:#4f46e5; font-weight:600;' : 'color:#374151;';
                    el.style.cssText = `padding: 10px 12px; margin-bottom: 4px; border-radius: 6px; cursor:pointer; font-size: 13px; border: 1px solid ${currentNoteId === n.id ? '#c7d2fe' : 'transparent'}; ${isActiveStyle} transition: all 0.2s; display: flex; justify-content: space-between; align-items: center;`;

                    const titleSpan = document.createElement('span');
                    titleSpan.style.cssText = 'white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1;';
                    titleSpan.setAttribute('title', n.title || '');
                    titleSpan.textContent = n.title || '';

                    const del = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                    del.setAttribute('class', 'delete-note-btn');
                    del.setAttribute('viewBox', '0 0 24 24');
                    del.setAttribute('fill', 'none');
                    del.setAttribute('stroke', 'currentColor');
                    del.setAttribute('stroke-width', '2');
                    del.setAttribute('style', 'width:14px; height:14px; color:#ef4444; cursor:pointer; display:none; margin-left:8px;');

                    const delPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                    delPath.setAttribute('d', 'M3 6h18M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2');
                    del.appendChild(delPath);

                    el.appendChild(titleSpan);
                    el.appendChild(del);
                    el.onclick = () => selectNote(n);
                    
                    // Add simple hover effect via events since inline CSS has no hover
                    el.onmouseenter = () => {
                        if (currentNoteId !== n.id) el.style.background = '#f3f4f6';
                        del.style.display = 'block';
                    };
                    el.onmouseleave = () => {
                        if (currentNoteId !== n.id) el.style.background = 'transparent';
                        del.style.display = 'none';
                    };
                    del.onclick = async (e) => {
                        e.stopPropagation();
                        const confirmed = await showConfirmDelete('Delete this note permanently?');
                        if(confirmed) {
                            fetch(`/api/v1/meetings/notes/${teamId}/${n.id}`, {method: 'DELETE'})
                            .then(() => {
                                if(currentNoteId == n.id) { 
                                    currentNoteId = null; 
                                    document.getElementById('currentNoteTitle').innerText = 'Select a note'; 
                                    document.getElementById('editorEmptyState').style.display = 'flex'; 
                                    quill.root.innerHTML = ''; 
                                }
                                loadNotes();
                                showToast("Note deleted", "success");
                            });
                        }
                    };
                    
                    list.appendChild(el);
                });
            }).catch(e => showToast("Error loading notes: " + e.message, "error"));
    }

    window.selectFolder = function(fid) {
        currentFolderId = fid;
        currentNoteId = null;
        document.getElementById('currentNoteTitle').innerText = 'Select a note';
        document.getElementById('editorEmptyState').style.display = 'flex';
        quill.root.innerHTML = '';
        loadFolders();
        loadNotes();
    };

    window.selectNote = function(note) {
        currentNoteId = note.id;
        document.getElementById('currentNoteTitle').innerText = note.title;
        document.getElementById('editorEmptyState').style.display = 'none';
        // set contents without emitting events that could cause false dirty flags
        if(quill.clipboard) {
            quill.clipboard.dangerouslyPasteHTML(note.content || '');
        } else {
            quill.root.innerHTML = note.content || '';
        }
        loadNotes(); // highlight active
    };

    const folderInputUI = document.getElementById('newFolderContainer');
    const folderInput = document.getElementById('newFolderInput');
    const noteInputUI = document.getElementById('newNoteContainer');
    const noteInput = document.getElementById('newNoteInput');

    document.getElementById('addFolderBtnUI').addEventListener('click', () => {
        folderInputUI.style.display = folderInputUI.style.display === 'none' ? 'block' : 'none';
        if (folderInputUI.style.display === 'block') folderInput.focus();
    });

    function submitFolder() {
        let name = folderInput.value.trim();
        if (name) {
            fetch(`/api/v1/meetings/folders/${teamId}`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({name: name})
            })
            .then(res => {
                if(!res.ok) throw new Error("API Error: Make sure you've restarted your python server terminal.");
                return res.json();
            })
            .then(() => {
                folderInput.value = '';
                folderInputUI.style.display = 'none';
                loadFolders();
                showToast("Folder created");
            });
        }
    }

    folderInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submitFolder();
    });
    document.getElementById('submitFolderBtn').addEventListener('click', submitFolder);

    document.getElementById('addNoteBtnUI').addEventListener('click', () => {
        noteInputUI.style.display = noteInputUI.style.display === 'none' ? 'block' : 'none';
        if (noteInputUI.style.display === 'block') noteInput.focus();
    });

    function submitNote() {
        let title = noteInput.value.trim();
        if (title) {
            fetch(`/api/v1/meetings/notes/${teamId}`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({title: title, folder_id: currentFolderId, content: ''})
            })
            .then(res => {
                if(!res.ok) throw new Error("API Error: Make sure you've restarted your python server terminal.");
                return res.json();
            })
            .then(n => {
                noteInput.value = '';
                noteInputUI.style.display = 'none';
                selectNote(n);
                showToast("Note created");
            });
        }
    }

    noteInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submitNote();
    });
    document.getElementById('submitNoteBtn').addEventListener('click', submitNote);

    document.getElementById('saveNoteBtn').addEventListener('click', () => {
        if (!currentNoteId) {
            showToast("Select or create a note first!", "error");
            return;
        }
        fetch(`/api/v1/meetings/notes/${teamId}/${currentNoteId}`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                content: quill.root.innerHTML
            })
        }).then(res => {
            if(res.ok) {
                showToast("Note saved successfully", "success");
            } else {
                showToast("Failed to save note", "error");
            }
        });
    });

    // Initialize
    loadFolders();
    loadNotes();


    /* -------------------------------------------------------------------------- */
    /*                              Audio & Recording                           */
    /* -------------------------------------------------------------------------- */
    const uploadClick = document.getElementById('uploadClick');
    const audioFileInput = document.getElementById('audioFileInput');
    const uploadProgress = document.getElementById('uploadProgress');
    const uploadFill = document.getElementById('uploadFill');
    const uploadPercent = document.getElementById('uploadPercent');
    const uploadStatusLabel = document.getElementById('uploadStatusLabel');
    const aiStatusBadge = document.getElementById('aiStatusBadge');
    
    // Wire top record button
    const topRecordBtn = document.getElementById('topRecordBtn');

    uploadClick.addEventListener('click', () => audioFileInput.click());

    audioFileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            uploadAudio(e.target.files[0]);
        }
    });

    // Mic Recording
    let mediaRecorder;
    let audioChunks = [];
    let isRecording = false;

    topRecordBtn.addEventListener('click', async () => {
        if (isRecording) {
            // Stop recording
            if (mediaRecorder && mediaRecorder.state !== 'inactive') {
                mediaRecorder.stop();
                mediaRecorder.stream.getTracks().forEach(track => track.stop());
            }
            topRecordBtn.classList.remove('record-btn-pulsing');
            isRecording = false;
            showToast("Recording stopped.", "success");
        } else {
            // Start recording
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                mediaRecorder = new MediaRecorder(stream);
                
                mediaRecorder.ondataavailable = event => {
                    audioChunks.push(event.data);
                };

                mediaRecorder.onstop = () => {
                    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                    audioChunks = []; // reset
                    uploadAudio(audioBlob, 'meeting_recording.webm');
                };

                mediaRecorder.start();
                topRecordBtn.classList.add('record-btn-pulsing');
                isRecording = true;
                showToast("Recording started...", "success");
                
                document.getElementById('aiResults').style.display = 'none';
                aiStatusBadge.innerText = "RECORDING...";
                
            } catch (err) {
                showToast("Could not access microphone: " + err, "error");
            }
        }
    });

    function uploadAudio(fileBlob, filename = null) {
        uploadProgress.style.display = 'flex';
        uploadFill.style.backgroundColor = "#4f46e5"; 
        uploadFill.style.width = "0%";
        uploadPercent.innerText = "0%";
        uploadStatusLabel.innerText = "UPLOADING...";
        aiStatusBadge.innerText = "UPLOADING...";

        const formData = new FormData();
        formData.append('team_id', teamId);
        formData.append('file', fileBlob, filename || fileBlob.name);

        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/v1/meetings/upload-audio', true);
        
        const token = localStorage.getItem('access_token');
        if (token) {
            xhr.setRequestHeader('Authorization', 'Bearer ' + token);
        }

        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
                const percent = Math.round((e.loaded / e.total) * 100);
                uploadFill.style.width = percent + '%';
                uploadPercent.innerText = percent + '%';
            }
        };

        xhr.onload = function() {
            if (xhr.status === 200) {
                uploadStatusLabel.innerText = "PROCESSING WITH AI...";
                uploadPercent.innerText = "";
                uploadFill.style.width = "100%";
                uploadFill.style.backgroundColor = "#10b981"; // green
                aiStatusBadge.innerText = "ANALYZING...";
                
                showToast("Audio safely uploaded. AI summarizes in background.", "success");

                // In a real scenario, we might poll. Here we simulate finishing.
                setTimeout(() => {
                    uploadProgress.style.display = 'none';
                    document.getElementById('aiResults').style.display = 'block';
                    document.getElementById('takeawaysList').innerHTML = `
                        <li><span>Processing has completed and stored in the AI Brain safely. Ask the AI Brain for summaries!</span></li>
                    `;
                    aiStatusBadge.innerText = "READY";
                }, 3000);
            } else {
                showToast("Error uploading audio.", "error");
                uploadProgress.style.display = 'none';
                aiStatusBadge.innerText = "ERROR";
            }
        };

        xhr.send(formData);
    }

    /* -------------------------------------------------------------------------- */
    /*                              History Loader                              */
    /* -------------------------------------------------------------------------- */
    function loadHistory() {
        const historyList = document.getElementById('historyList');
        historyList.innerHTML = '<p class="text-gray-500 text-sm">Loading histories...</p>';
        
        fetch(`/api/v1/rag/chat/sessions/${teamId}`)
            .then(res => res.json())
            .then(data => {
                historyList.innerHTML = '';
                if (!data.sessions || data.sessions.length === 0) {
                    historyList.innerHTML = '<p class="text-gray-500 text-sm">No recent histories found.</p>';
                    return;
                }
                
                data.sessions.forEach(sess => {
                    const el = document.createElement('div');
                    el.style.cssText = "padding: 12px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; margin-bottom: 10px;";
                    el.innerHTML = `
                        <div style="font-weight: 500; font-size: 14px;">Session: ${sess.session_id.substring(0,8)}...</div>
                        <div style="font-size: 12px; color: #6b7280; margin-top: 4px;">${new Date(sess.created_at).toLocaleString()}</div>
                    `;
                    historyList.appendChild(el);
                });
            })
            .catch(e => {
                historyList.innerHTML = '<p class="text-red-500 text-sm">Failed to load history.</p>';
            });
    }

});
