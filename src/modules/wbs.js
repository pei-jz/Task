import {
    project, selectedPhaseIds, setSelectedPhaseIds, saveState, assigneeColors,
    ganttZoomMode, undo, redo,
    loadData, getPixelsPerDay, syncAssigneeColors, triggerRender
} from './state.js';
import {
    normalizeDate, isBusinessDay, isHoliday, getDayOfWeek, getNextBusinessDay, addBusinessDays,
    generateId, ensureTaskProps, findTask, findParentList, getOverloadedAssignees, escapeVal,
    getBusinessDuration, DISTINCT_COLORS, formatDateWithDay,
    calculateEndDateFromStart, calculateStartDateFromEnd
} from './helpers.js';
import { renderTimeline, getDateRange } from './gantt.js';
import { showModal, showDatePicker } from './ui.js';


export let wbsFilters = { title: '', assignee: '' };
let activeFilterPopup = null;

export let selectedCell = { r: 0, c: 0 };
export let selectionAnchor = null;
export let isEditing = false;
const MAX_COLS = 11;

// --- WBS RENDERER ---
export function renderWBS() {
    const tableView = document.getElementById('wbs-table-view');
    const ganttView = document.getElementById('wbs-gantt-view');
    const filterLabel = document.getElementById('wbs-filter-label');
    if (!tableView || !ganttView || !project) return;

    tableView.innerHTML = ''; ganttView.innerHTML = '';

    // Expose actions to window for inline onclick handlers
    window.WBS_ACTION = {
        wbsFilters,
        renderWBS,
        togglePhase: (pid) => togglePhase(pid),
        toggleTask: (pid, tid) => toggleTask(pid, tid),
        openAddTaskModal: (pid) => openAddTaskModal(pid),
        addPhaseInfo: (id) => addPhaseInfo(id),
        addMilestoneInfo: () => addMilestoneInfo(),
        deleteTaskWin: (pid, tid) => deleteTaskWin(pid, tid),
        updateTask: (pid, tid, field, val) => updateTask(pid, tid, field, val),
        closeFilterPopup: () => {
            if (activeFilterPopup) {
                activeFilterPopup.remove();
                activeFilterPopup = null;
            }
        },
        pickDate: (pid, tid, field, currentVal) => {
            showDatePicker(currentVal, (newDate) => {
                updateTaskDate(pid, tid, field, newDate);
            }, project.holidays);
        }
    };

    // Scroll Sync
    setupScrollSync();

    // --- MILESTONES (Header) ---
    // Render markers in headerRow
    const renderMilestoneMarkers = () => {
        if (!project.milestones) return;
        project.milestones.forEach(m => {
            const d = normalizeDate(m.date);
            if (d && d >= minDate && d <= maxDate) {
                const pxLeft = (d.getTime() - minDate.getTime()) / 86400000 * PIXELS_PER_DAY;
                const marker = document.createElement('div');
                marker.className = 'milestone-marker-header';
                marker.style.position = 'absolute';
                marker.style.left = `${pxLeft - 6}px`; // Center
                marker.style.top = `${DATE_HEADER_HEIGHT + 5}px`; // Below date
                // Removed inline styles: width, height, background, transform, border, zIndex
                // These are now handled by CSS class .milestone-marker-header
                marker.title = `${m.title} (${m.date})`;

                headerRow.appendChild(marker);
            }
        });
    };

    const ROW_HEIGHT = 24;
    const activePhases = project.phases;

    // Removed "Multiple Phases" label logic per user request

    const isVisible = (t) => {
        if (t.isPhase) {
            return t.subtasks && t.subtasks.some(st => isVisible(st));
        }
        const titleVal = (t.title || '').toLowerCase();
        const assignVal = (t.assignee && (t.assignee.name || t.assignee) || '').toLowerCase();
        const filterTitle = (wbsFilters.title || '').toLowerCase();
        const filterAssign = (wbsFilters.assignee || '').toLowerCase();

        const matchTitle = !filterTitle || titleVal.includes(filterTitle);
        const matchAssignee = !filterAssign || assignVal.indexOf(filterAssign) >= 0;

        const selfMatch = matchTitle && matchAssignee;
        if (t.subtasks && t.subtasks.length > 0) {
            return selfMatch || t.subtasks.some(st => isVisible(st));
        }
        return selfMatch;
    };

    let rootTasks = [];
    activePhases.forEach(p => {
        const phaseNode = {
            id: p.id, title: p.name, start: p.start, end: p.end, subtasks: p.tasks,
            expanded: p.expanded !== false, isPhase: true, assignee: null, estimate: 0, isRoot: true
        };
        ensureTaskProps(p.tasks);
        rootTasks.push(phaseNode);
    });

    // Table Setup
    const table = document.createElement('table'); table.className = 'wbs-table';
    table.innerHTML = `<thead>
        <tr style="height:50px;">
            <th style="width:200px; padding:4px; height:50px;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    Task Name <span class="filter-icon" onclick="openFilterMenu(event, 'title')">▼</span>
                </div>
            </th>
            <th style="width:90px; height:50px;">Status</th>
            <th style="width:125px; height:50px;">Start</th>
            <th style="width:125px; height:50px;">End</th>
            <th style="width:125px; height:50px;">Act. Start</th>
            <th style="width:125px; height:50px;">Act. End</th>
            <th style="width:50px; height:50px;">Est(h)</th>
            <th style="width:50px; height:50px;">Act(h)</th>
            <th style="width:80px; padding:4px; height:50px;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    Assignee <span class="filter-icon" onclick="openFilterMenu(event, 'assignee')">▼</span>
                </div>
            </th>
            <th style="width:80px; height:50px;">Pred.</th>
            <th style="width:30px; height:50px;"></th>
        </tr>
    </thead>`;
    const tbody = document.createElement('tbody');
    table.appendChild(tbody);

    // Gantt Setup
    const MONTH_HEADER_HEIGHT = 20;
    const DATE_HEADER_HEIGHT = 30;
    const HEADER_HEIGHT = 50;

    const { minDate, maxDate, totalTime } = getDateRange();
    const PIXELS_PER_DAY = getPixelsPerDay();
    const gCanvas = document.createElement('div'); gCanvas.className = 'wbs-gantt-canvas';

    // Grid Setup
    const gGrid = document.createElement('div'); gGrid.style.position = 'absolute';
    gGrid.style.top = '0'; gGrid.style.height = '100%'; gGrid.style.width = '100%';

    // Width calc
    const daysCount = totalTime / (1000 * 60 * 60 * 24);
    const visibleDays = Math.ceil((ganttView.clientWidth || 800) / PIXELS_PER_DAY);
    const extendDays = Math.max(0, visibleDays - daysCount + 5);

    // Canvas dimensions
    const totalDrawDays = daysCount + extendDays;
    const totalCWidth = Math.max((ganttView.clientWidth || 800), totalDrawDays * PIXELS_PER_DAY);
    gCanvas.style.width = `${totalCWidth}px`;

    const headerRow = document.createElement('div');
    headerRow.style.position = 'sticky'; headerRow.style.top = '0';
    headerRow.style.height = `${HEADER_HEIGHT}px`; headerRow.style.width = '100%';
    headerRow.style.zIndex = '50'; headerRow.style.background = 'var(--card-bg)';
    headerRow.style.borderBottom = '1px solid var(--border-color)';
    gCanvas.appendChild(headerRow);

    // Draw Grid & Header
    const drawEndT = minDate.getTime() + (totalCWidth / PIXELS_PER_DAY) * 86400000;
    let iter = new Date(minDate); iter.setHours(12, 0, 0, 0);

    while (iter.getTime() <= drawEndT) {
        const d = new Date(iter); d.setHours(0, 0, 0, 0);
        const pxLeft = (d.getTime() - minDate.getTime()) / 86400000 * PIXELS_PER_DAY;

        const l = document.createElement('div'); l.className = 'grid-line';
        l.style.left = `${pxLeft}px`; l.style.width = `${PIXELS_PER_DAY}px`;
        l.style.borderRight = '1px solid var(--wbs-grid-color)';

        if (isHoliday(d, project.holidays)) l.classList.add('grid-col-holiday');
        else if (d.getDay() === 0) l.classList.add('grid-col-sun');
        else if (d.getDay() === 6) l.classList.add('grid-col-sat');
        gGrid.appendChild(l);

        // Header Logic
        let showDate = true;
        if (ganttZoomMode === 'month' && d.getDate() !== 1) showDate = false;
        if (ganttZoomMode === 'week' && d.getDay() !== 1) showDate = false;

        if (showDate) {
            const h = document.createElement('div');
            h.style.position = 'absolute'; h.style.left = `${pxLeft}px`; h.style.width = `${PIXELS_PER_DAY}px`;
            h.style.top = `${MONTH_HEADER_HEIGHT}px`; h.style.height = `${DATE_HEADER_HEIGHT}px`;
            h.style.fontSize = '0.7rem'; h.style.color = '#64748b';
            h.style.display = 'flex'; h.style.flexDirection = 'column';
            h.style.justifyContent = 'center'; h.style.alignItems = 'center'; h.style.lineHeight = '1.1';

            const dayNames = ['(日)', '(月)', '(火)', '(水)', '(木)', '(金)', '(土)'];
            const dateText = `${d.getMonth() + 1}/${d.getDate()}`;

            if (ganttZoomMode === 'day') {
                const dayText = dayNames[d.getDay()];
                h.innerHTML = `<div>${dateText}</div><div style="font-size:0.65rem; opacity:0.8;">${dayText}</div>`;
                if (isHoliday(d, project.holidays)) h.classList.add('holiday');
                else if (d.getDay() === 0) h.classList.add('sunday');
                else if (d.getDay() === 6) h.classList.add('saturday');
                else h.classList.add('weekday');
            } else {
                h.textContent = dateText;
            }
            headerRow.appendChild(h);
        }

        if (d.getDate() === 1 || iter.getTime() === new Date(minDate).setHours(12, 0, 0, 0)) {
            const mDiv = document.createElement('div');
            mDiv.style.position = 'absolute'; mDiv.style.left = `${pxLeft}px`; mDiv.style.top = '0';
            mDiv.style.height = `${MONTH_HEADER_HEIGHT}px`; mDiv.style.fontSize = '0.8rem'; mDiv.style.fontWeight = 'bold';
            mDiv.textContent = `${d.getFullYear()}.${d.getMonth() + 1}`;
            headerRow.appendChild(mDiv);
        }
        iter.setDate(iter.getDate() + 1);
        if (iter.getFullYear() > new Date(maxDate).getFullYear() + 2) break;
    }

    // Render Milestones in Header (Call After Header Grid)
    renderMilestoneMarkers();

    gCanvas.appendChild(gGrid);

    const gRowsContainer = document.createElement('div');
    gRowsContainer.className = 'gantt-rows-container';
    gRowsContainer.style.position = 'relative'; gRowsContainer.style.zIndex = '5';
    gCanvas.appendChild(gRowsContainer);

    let currentRowIndex = 0;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const { taskIds: overloadedIds } = getOverloadedAssignees(project);

    // Dependencies SVG
    const svgLayer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svgLayer.style.position = 'absolute'; svgLayer.style.top = '0'; svgLayer.style.left = '0';
    svgLayer.style.width = '100%'; svgLayer.style.height = '100%'; svgLayer.style.pointerEvents = 'none'; svgLayer.style.zIndex = '4';
    gCanvas.insertBefore(svgLayer, gRowsContainer);

    const renderTaskNode = (tasks, level, currentPhaseId) => {
        tasks.forEach(t => {
            if (!t.isPhase && !isVisible(t)) return;
            if (t.isPhase && !t.subtasks.some(st => isVisible(st))) return;

            // Row Creation (Same as main.js)
            const tr = document.createElement('tr');
            tr.id = `row-${t.id}`;
            tr.style.height = `${ROW_HEIGHT}px`;
            if (t.isPhase) { tr.style.backgroundColor = 'var(--active-phase-row-bg)'; tr.style.fontWeight = 'bold'; }
            else if (t.end) {
                const eDate = new Date(t.end); eDate.setHours(0, 0, 0, 0);
                if (eDate < today) tr.className = 'task-danger';
                else if (eDate.getTime() === today.getTime() || eDate.getTime() === today.getTime() + 86400000) tr.className = 'task-warning';
            }

            // Cell Generation Helpers
            const effectivePid = t.isPhase ? t.id : currentPhaseId;
            const indent = level * 16;
            const hasChildren = t.subtasks && t.subtasks.length > 0;
            const isExpanded = (t.expanded !== false);
            // Change to use window.WBS_ACTION with stopPropagation
            const toggleFn = t.isPhase ? `event.stopPropagation(); window.WBS_ACTION.togglePhase('${t.id}')` : `event.stopPropagation(); window.WBS_ACTION.toggleTask('${effectivePid}', '${t.id}')`;

            const td = (i, html) => {
                const isSel = selectedCell.r === currentRowIndex && selectedCell.c === i;
                const style = isSel ? 'padding:0; outline: 2px solid #3b82f6; z-index: 10;' : 'padding:0;';
                return `<td data-row="${currentRowIndex}" data-col="${i}" style="${style}" onclick="selectCell(${currentRowIndex}, ${i}, event)" ondblclick="enterEditMode()">${html}</td>`;
            };
            const dateCell = (pid, tid, field, val) => {
                const disp = formatDateWithDay(val);
                return `<div class="wbs-date-cell" onclick="event.stopPropagation(); window.WBS_ACTION.pickDate('${pid}','${tid}','${field}','${val}')" style="cursor:pointer; width:100%; height:100%; display:flex; align-items:center; padding:0 4px;">${disp}</div>`;
            };

            const handle = `<span class="drag-handle" style="cursor:grab; color:#ccc; margin-right:4px; pointer-events:auto;">☰</span>`;
            const toggleHtml = hasChildren ? `<span class="task-toggle-btn" onclick="${toggleFn}" style="pointer-events:auto;">${isExpanded ? '▼' : '▶'}</span>` : `<span style="width:16px; margin-right:4px;"></span>`;

            const assigneeName = t.assignee ? (t.assignee.name || t.assignee) : '';
            const assignOpts = (project.assignees || []).map(a => `<option value="${a.name}" ${a.name === assigneeName ? 'selected' : ''}>${a.name}</option>`).join('');

            const statusColor = t.status === 'done' ? '#dcfce7' : (t.status === 'doing' ? '#dbeafe' : '#f3f4f6');

            tr.innerHTML = `
                <td data-row="${currentRowIndex}" data-col="0" style="padding-left:0.5rem;" onclick="selectCell(${currentRowIndex}, 0, event)" ondblclick="enterEditMode()">
                    <div class="task-indent-wrapper" style="padding-left:${indent}px; pointer-events:none;">
                        ${handle} ${toggleHtml}
                        ${t.isPhase ? `<span>${t.title}</span>` : `<input value="${t.title}" onchange="window.WBS_ACTION.updateTask('${effectivePid}','${t.id}','title',this.value)" style="${hasChildren ? 'font-weight:bold' : ''}; pointer-events:auto;" onclick="event.stopPropagation()">`}
                        <button class="subtask-btn" onclick="event.stopPropagation(); window.WBS_ACTION.openAddTaskModal('${t.id}')" style="pointer-events:auto;">+</button>
                    </div>
                </td>
                ${td(1, t.isPhase ? '' : `<div style="text-align:center;"><select onchange="window.WBS_ACTION.updateTask('${effectivePid}','${t.id}','status',this.value)" class="status-${t.status || 'todo'}" style="width:90%; border-radius:4px;"><option value="todo" ${t.status === 'todo' ? 'selected' : ''}>To Do</option><option value="doing" ${t.status === 'doing' ? 'selected' : ''}>Doing</option><option value="done" ${t.status === 'done' ? 'selected' : ''}>Done</option></select></div>`)}
                ${td(2, t.isPhase ? `<span>${formatDateWithDay(t.start)}</span>` : dateCell(effectivePid, t.id, 'start', t.start))}
                ${td(3, t.isPhase ? `<span>${formatDateWithDay(t.end)}</span>` : dateCell(effectivePid, t.id, 'end', t.end))}
                ${td(4, t.isPhase ? '' : dateCell(effectivePid, t.id, 'actualStart', t.actualStart))}
                ${td(5, t.isPhase ? '' : dateCell(effectivePid, t.id, 'actualEnd', t.actualEnd))}
                ${td(6, t.isPhase ? '' : `<input type="number" value="${t.estimate || 0}" onchange="window.WBS_ACTION.updateTask('${effectivePid}','${t.id}','estimate',this.value)" style="width:100%; text-align:right;">`)}
                ${td(7, t.isPhase ? '' : `<input type="number" value="${t.actualHours || 0}" onchange="window.WBS_ACTION.updateTask('${effectivePid}','${t.id}','actualHours',this.value)" style="width:100%; text-align:right;">`)}
                ${td(8, t.isPhase ? '' : `<select onchange="window.WBS_ACTION.updateTask('${effectivePid}','${t.id}','assignee',this.value)" style="width:100%"><option value="">(Unassigned)</option>${assignOpts}</select>`)}
                ${td(9, t.isPhase ? '' : `<input type="text" value="${(t.predecessors || []).join(',')}" onchange="window.WBS_ACTION.updateTask('${effectivePid}','${t.id}','predecessors',this.value)" style="width:100%;">`)}
                <td data-row="${currentRowIndex}" data-col="10" style="text-align:center;">${t.isPhase ? '' : `<button class="danger-btn" onclick="window.WBS_ACTION.deleteTaskWin('${effectivePid}','${t.id}')">×</button>`}</td>
            `;

            // Drag Events
            tr.draggable = true;
            tr.ondragstart = (e) => {
                e.stopPropagation();
                e.dataTransfer.setData('text/plain', JSON.stringify({ pid: effectivePid, tid: t.id, isPhase: t.isPhase }));
                tr.classList.add('dragging');
            };
            tr.ondragover = (e) => { e.preventDefault(); tr.classList.add('drag-over'); };
            tr.ondragleave = () => tr.classList.remove('drag-over');
            tr.ondrop = (e) => {
                e.preventDefault(); tr.classList.remove('drag-over');
                try {
                    const src = JSON.parse(e.dataTransfer.getData('text/plain'));
                    handleTaskDrop(src, { pid: effectivePid, tid: t.id, isPhase: t.isPhase });
                } catch (err) { }
            };
            tr.ondragend = () => { tr.classList.remove('dragging'); document.querySelectorAll('.drag-over').forEach(e => e.classList.remove('drag-over')); };

            tbody.appendChild(tr);

            // Gantt Row
            const gRow = document.createElement('div'); gRow.className = 'gantt-row'; gRow.style.height = `${ROW_HEIGHT}px`;
            gRow.style.width = '100%'; gRow.style.position = 'relative';

            if (t.start && t.end && totalTime > 0) {
                const s = normalizeDate(t.start), e = normalizeDate(t.end);
                if (s && e && s <= maxDate && e >= minDate) {
                    const startPx = (Math.max(s.getTime(), minDate.getTime()) - minDate.getTime()) / 86400000 * PIXELS_PER_DAY;
                    const endForCalc = new Date(e.getTime() + 86400000);
                    const endPx = (Math.min(endForCalc.getTime(), maxDate.getTime()) - minDate.getTime()) / 86400000 * PIXELS_PER_DAY;
                    const widthPx = Math.max(endPx - startPx, 1);

                    if (widthPx > 0) {
                        const bar = document.createElement('div');
                        bar.id = `bar-${t.id}`;
                        bar.className = hasChildren || t.isPhase ? 'gantt-bar parent-task' : 'gantt-bar';

                        // Styles
                        if (t.isPhase) { bar.style.backgroundColor = 'var(--phase-color)'; bar.style.opacity = '0.7'; }
                        else {
                            const tipColor = t.status === 'done' ? '#22c55e' : (t.status === 'doing' ? '#3b82f6' : '#9ca3af');
                            const bodyColor = (t.assignee && assigneeColors[t.assignee.name || t.assignee]) || '#cbd5e1';
                            bar.style.backgroundColor = bodyColor;
                            bar.style.borderLeft = `10px solid ${tipColor}`;
                        }
                        if (overloadedIds.has(t.id)) {
                            bar.classList.add('task-overload');
                            bar.style.backgroundImage = 'repeating-linear-gradient(45deg, transparent, transparent 5px, rgba(239, 68, 68, 0.3) 5px, rgba(239, 68, 68, 0.3) 10px)';
                        }

                        bar.style.left = `${startPx}px`; bar.style.width = `${widthPx}px`;
                        bar.style.top = '6px'; bar.style.height = `${ROW_HEIGHT - 12}px`;
                        bar.style.position = 'absolute';
                        gRow.appendChild(bar);
                    }
                }
            }
            gRowsContainer.appendChild(gRow);

            currentRowIndex++;
            if (hasChildren && isExpanded) {
                renderTaskNode(t.subtasks, level + 1, effectivePid);
            }
        });
    };

    renderTaskNode(rootTasks, 0, null);

    gCanvas.style.height = `${Math.max(currentRowIndex * ROW_HEIGHT + HEADER_HEIGHT, 150)}px`;

    // Draw Dependency Lines
    project.phases.forEach(p => {
        const traverse = (t) => {
            if (t.predecessors && t.predecessors.length > 0) {
                const tgtBar = document.getElementById(`bar-${t.id}`); // This requires that bar is in DOM. It is, since we appended gRow.
                if (tgtBar) {
                    const pids = Array.isArray(t.predecessors) ? t.predecessors : String(t.predecessors).split(',');
                    pids.forEach(pid => {
                        const srcBar = document.getElementById(`bar-${pid.trim()}`);
                        if (srcBar) {

                            const srcRect = srcBar.getBoundingClientRect();
                            const tgtRect = tgtBar.getBoundingClientRect();
                            const canvasRect = gCanvas.getBoundingClientRect();

                            // Relative to gCanvas
                            const x1 = srcRect.right - canvasRect.left + gCanvas.scrollLeft;
                            const y1 = srcRect.top - canvasRect.top + srcRect.height / 2;
                            const x2 = tgtRect.left - canvasRect.left + gCanvas.scrollLeft;
                            const y2 = tgtRect.top - canvasRect.top + tgtRect.height / 2;

                            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                            const dx = Math.abs(x2 - x1) / 2;
                            const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;

                            path.setAttribute('d', d);
                            path.setAttribute('stroke', 'var(--dependency-line-color)'); path.setAttribute('stroke-width', '2'); path.setAttribute('fill', 'none');
                            svgLayer.appendChild(path);
                        }
                    });
                }
            }
            if (t.subtasks) t.subtasks.forEach(traverse);
        };
        traverse(p);
    });

    tableView.appendChild(table);
    ganttView.appendChild(gCanvas);

    // Sync Scroll
    tableView.onscroll = () => { ganttView.scrollTop = tableView.scrollTop; };
    ganttView.onscroll = () => { tableView.scrollTop = ganttView.scrollTop; };

    // Restore Selection Visuals
    updateSelectionVisuals();
}

// --- ACTIONS ---

export function toggleTask(pid, tid) {
    const p = project.phases.find(ph => ph.id === pid);
    const t = findTask(p, tid);
    if (t) { t.expanded = !t.expanded; triggerRender(); }
}

export function togglePhase(pid) {
    const p = project.phases.find(ph => ph.id === pid);
    if (p) { p.expanded = !p.expanded; triggerRender(); }
}

export function updateTask(pid, tid, field, value) {
    saveState();
    const p = project.phases.find(ph => ph.id === pid);
    const t = findTask(p, tid);
    if (!t) return;

    // Logic from main.js (assignee change, status change, dates, auto-schedule)
    if (field === 'assignee') {
        const assignObj = project.assignees.find(a => a.name === value);
        t.assignee = assignObj || value;
    } else if (field === 'status') {
        t.status = value;
        const now = new Date().toISOString().split('T')[0];
        if (value === 'doing' && !t.actualStart) t.actualStart = now;
        if (value === 'done') { t.actualEnd = now; t.progress = 100; }
    } else if (field === 'predecessors') {
        if (typeof value === 'string') t.predecessors = value.split(',').map(s => s.trim()).filter(s => s);
        else t.predecessors = value;
    } else {
        t[field] = value;

        // Auto-schedule based on Estimate (if estimate > 0)
        if (t.estimate && t.estimate > 0) {
            if (field === 'start' && value) {
                // Start changed -> Calc End
                const newEnd = calculateEndDateFromStart(value, t.estimate, project.holidays);
                if (newEnd) t.end = newEnd;
            } else if (field === 'end' && value) {
                // End changed -> Calc Start
                const newStart = calculateStartDateFromEnd(value, t.estimate, project.holidays);
                if (newStart) t.start = newStart;
            }
        }
    }

    // TODO: cascadeSchedule logic (simplified for now to re-render)
    triggerRender();
}

export function updateTaskDate(pid, tid, field, value) {
    // Logic from main.js (fuzzy parse)
    updateTask(pid, tid, field, value); // simplified
}

export function deleteTaskWin(pid, tid) {
    if (!confirm('Delete task?')) return;
    saveState();
    const p = project.phases.find(ph => ph.id === pid);
    const list = findParentList(p, tid);
    if (list) {
        const idx = list.findIndex(t => t.id === tid);
        if (idx >= 0) list.splice(idx, 1);
        triggerRender();
    }
}

export function openAddTaskModal(pid) {
    // Logic from main.js
    if (selectedPhaseIds.length === 0) { alert('Select a Phase'); return; }
    // ...
    // Using simple prompt or showModal
    showModal('Add Task', `
        <label>Title</label><input id="nt-title" class="modal-input">
        <div class="modal-row"><input type="date" id="nt-start" class="modal-input"><input type="date" id="nt-end" class="modal-input"></div>
        <label>Assignee</label>
        <select id="nt-assignee" class="modal-input">
            <option value="">(Unassigned)</option>
            ${(project.assignees || []).map(a => `<option value="${a.name}">${a.name}</option>`).join('')}
        </select>
        <label>Estimate (h)</label><input type="number" id="nt-est" class="modal-input" value="0">
    `, () => {
        saveState();
        const title = document.getElementById('nt-title').value;
        const assigneeVal = document.getElementById('nt-assignee').value;
        const estVal = parseFloat(document.getElementById('nt-est').value) || 0;

        // ... creation logic ...
        // Simplification:
        const p = project.phases.find(ph => ph.id === pid); // pass pid
        if (p && title) {
            const assigneeObj = (project.assignees || []).find(a => a.name === assigneeVal);
            const newTask = {
                id: generateId(),
                title,
                status: 'todo',
                start: document.getElementById('nt-start').value,
                end: document.getElementById('nt-end').value,
                assignee: assigneeObj || assigneeVal,
                estimate: estVal
            };

            // Correction: findTask or Phase
            let parentTask = findTask(p, pid);
            if (parentTask && parentTask.id === pid) {
                if (!parentTask.subtasks) parentTask.subtasks = [];
                parentTask.subtasks.push(newTask); parentTask.expanded = true;
            } else if (p.id === pid) {
                p.tasks.push(newTask);
            }
            triggerRender();
        }
    });
}


export function handlePaste(text) {
    if (!text) return;
    const rows = text.split('\n');
    if (rows.length === 0) return;

    // Parse simple TSV/CSV-like paste
    let r = selectedCell.r;
    let c = selectedCell.c;

    const activePhases = project.phases;
    // Flatten visible tasks for navigation/paste mapping
    let visibleTasks = [];
    const traverse = (list, pid) => {
        list.forEach(t => {
            if (t.isPhase) {
                visibleTasks.push({ ...t, pid: t.id, isPhase: true }); // Phase row
                if (t.expanded !== false && t.subtasks) traverse(t.subtasks, t.id);
            } else {
                visibleTasks.push({ ...t, pid: pid });
                if (t.expanded !== false && t.subtasks) traverse(t.subtasks, pid);
            }
        });
    };
    activePhases.forEach(p => {
        visibleTasks.push({ ...p, pid: p.id, isPhase: true });
        if (p.expanded !== false && p.tasks) traverse(p.tasks, p.id);
    });
    // Note: The above traversal must match renderWBS visual order exactly.
    // renderWBS logic: rootTasks (which are phases wrapper).
    // Let's replicate renderWBS flat list logic if needed, or rely on data structure.
    // The traversal above seems correct for "Visible Rows".

    // Re-Traverse to ensure we match the View Loop (Active Phases -> Phase Node -> Subtasks)
    visibleTasks = [];
    activePhases.forEach(p => {
        visibleTasks.push({ id: p.id, isPhase: true, title: p.name });
        if (p.expanded !== false) {
            const tTraverse = (list, pid) => {
                list.forEach(t => {
                    visibleTasks.push({ ...t, pid });
                    if (t.expanded !== false && t.subtasks) tTraverse(t.subtasks, pid);
                });
            };
            tTraverse(p.tasks, p.id);
        }
    });

    let changes = false;

    if (rows) { // Check if rows exists (it should from handlePaste top)
        rows.forEach((rowStr, rOffset) => {
            const targetRowIdx = r + rOffset;
            if (targetRowIdx >= visibleTasks.length) return;

            const targetTaskInfo = visibleTasks[targetRowIdx];
            if (!targetTaskInfo || targetTaskInfo.isPhase) return; // Skip phases (read-only mostly) or handle differently?

            const p = project.phases.find(ph => ph.id === targetTaskInfo.pid);
            if (!p) return;
            const t = findTask(p, targetTaskInfo.id);
            if (!t) return;

            const cols = rowStr.split('\t');
            if (cols.length === 0) return;

            // Paste logic per cell
            cols.forEach((val, cOffset) => {
                const targetColIdx = c + cOffset;
                // Column Mapping matches renderWBS
                // 1: Status, 2: Start, 3: End, 6: Est, 7: Act, 8: Assignee, 9: Pred

                let field = null;
                switch (targetColIdx) {
                    case 1: field = 'status'; break;
                    case 2: field = 'start'; break;
                    case 3: field = 'end'; break;
                    case 6: field = 'estimate'; break;
                    case 7: field = 'actualHours'; break;
                    case 8: field = 'assignee'; break;
                    case 9: field = 'predecessors'; break;
                }

                if (field) {
                    // Update value
                    // Basic type conversion
                    let finalVal = val.trim();

                    if (field === 'estimate' || field === 'actualHours') {
                        finalVal = parseFloat(finalVal) || 0;
                    }
                    else if (field === 'status') {
                        // Validate status values? 
                        const valid = ['todo', 'doing', 'done'];
                        if (!valid.includes(finalVal.toLowerCase())) return; // invalid status
                        finalVal = finalVal.toLowerCase();
                    }
                    else if (field === 'assignee') {
                        // Find assignee object or create? 
                        // Usually we just set name if string.
                    }

                    // Apply update directly to avoid triggering updateTask 100 times
                    // We duplicate updateTask logic briefly or just set props.
                    // For batch paste, simple prop set is often enough.
                    // Special handling for Status -> Progress?
                    if (field === 'status') {
                        t.status = finalVal;
                        if (t.status === 'done') { t.progress = 100; t.actualEnd = new Date().toISOString().split('T')[0]; }
                    } else {
                        t[field] = finalVal;
                    }
                    changes = true;
                }
            });
        });

        if (changes) {
            saveState();
            triggerRender();
        }
    }
}

export async function copySelection() {
    if (!selectedRange || !project) return;

    // 1. Identify tasks in range
    // We need a map of RowIndex -> Task.
    // Re-generate visibleTasks list (Same logic as handlePaste)
    let visibleTasks = [];
    const traverse = (list, pid) => {
        list.forEach(t => {
            // We skip Phases in copy explicitly? Or include? 
            // If we copy a phase row, what do we get? Title? Dates?
            if (t.isPhase) visibleTasks.push(t);
            else visibleTasks.push(t);

            if (t.isPhase && t.expanded !== false && t.subtasks) traverse(t.subtasks, t.id);
            else if (!t.isPhase && t.expanded !== false && t.subtasks) traverse(t.subtasks, pid);
        });
    };
    project.phases.forEach(p => {
        visibleTasks.push(p);
        if (p.expanded !== false && p.tasks) traverse(p.tasks, p.id);
    });

    const rowsData = [];
    for (let r = selectedRange.r1; r <= selectedRange.r2; r++) {
        const task = visibleTasks[r]; // Index match? renderWBS uses currentRowIndex starting at 0.
        if (!task) continue;

        const rowCells = [];
        for (let c = selectedRange.c1; c <= selectedRange.c2; c++) {
            // Map keys
            let val = '';
            if (c === 0) val = task.title || task.name || ''; // Title / Name
            // 1: Status, 2: Start, 3: End, 4: Act Start, 5: Act End, 6: Est, 7: Act H, 8: Assignee, 9: Pred
            else if (task.isPhase) {
                // Phase only has Name (0), Start(2), End(3)
                if (c === 2) val = task.start || '';
                else if (c === 3) val = task.end || '';
            } else {
                switch (c) {
                    case 1: val = task.status || 'todo'; break;
                    case 2: val = task.start || ''; break;
                    case 3: val = task.end || ''; break;
                    case 4: val = task.actualStart || ''; break;
                    case 5: val = task.actualEnd || ''; break;
                    case 6: val = task.estimate || 0; break;
                    case 7: val = task.actualHours || 0; break;
                    case 8: val = (task.assignee && task.assignee.name) ? task.assignee.name : (task.assignee || ''); break;
                    case 9: val = (task.predecessors || []).join(','); break;
                }
            }
            rowCells.push(val);
        }
        rowsData.push(rowCells.join('\t'));
    }

    const textObj = rowsData.join('\n');

    // Write to Clipboard
    try {
        await navigator.clipboard.writeText(textObj);
        // Maybe visual feedback?
    } catch (err) {
        console.error('Copy failed', err);
    }
}

// New Flat Import Logic
export function importWBSFlat(text, unitStr, format) {
    saveState();
    const lines = text.trim().split('\n').map(l => l.trim()).filter(l => l);
    if (lines.length < 1) return;

    const multiplier = unitStr === 'days' ? 8 : 1;
    let separator = '\t';
    if (!lines[0].includes('\t')) separator = /\s{2,}/; // Fallback to double space

    const assigneeSchedule = {};
    const getAssignee = (name) => {
        if (!project.assignees) project.assignees = [];
        let a = project.assignees.find(x => x.name === name);
        if (!a) {
            const color = DISTINCT_COLORS.find(c => !project.assignees.some(ex => ex.color === c)) || '#' + Math.floor(Math.random() * 16777215).toString(16);
            a = { id: generateId(), name: name, color: color };
            project.assignees.push(a);
            assigneeColors[name] = color;
        }
        return a;
    };

    let currentPhase = null;
    if (project.phases.length > 0) currentPhase = project.phases[project.phases.length - 1];

    // Check for "Phase Columns (Auto)"
    const phaseColChipIdx = format.indexOf('phase_cols');
    if (phaseColChipIdx >= 0) {
        // --- MATRIX IMPORT MODE ---
        const headerLine = lines[0];
        const dataLines = lines.slice(1);
        let headers = headerLine.split(separator).map(h => h.trim());
        // Remove trailing empty headers (often from Excel pastes)
        while (headers.length > 0 && headers[headers.length - 1] === '') {
            headers.pop();
        }

        // Determine dynamic range
        // Chips before phase_cols map to 0..phaseColChipIdx-1
        // Chips after phase_cols map to headers.length - (format.length - 1 - phaseColChipIdx) ... end
        const chipsBefore = format.slice(0, phaseColChipIdx);
        const chipsAfter = format.slice(phaseColChipIdx + 1);

        const startDynIdx = chipsBefore.length;
        const endDynIdx = headers.length - chipsAfter.length;
        // Dynamic Columns are [startDynIdx, endDynIdx)

        if (endDynIdx <= startDynIdx) {
            alert("Error: Not enough columns for Phase mapping.");
            return;
        }

        const phaseHeaders = headers.slice(startDynIdx, endDynIdx);
        const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

        // Pre-create/Find all engineering phases
        const phaseMap = {};
        phaseHeaders.forEach((phName, i) => {
            let p = project.phases.find(x => x.name === phName);
            if (!p) {
                p = { id: generateId(), name: phName, start: project.start, end: project.start, tasks: [], expanded: true };
                project.phases.push(p);
            }
            phaseMap[phName] = p;
        });

        const rowLastEnd = {}; // To keep Feature A's step 2 after step 1

        dataLines.forEach(line => {
            const parts = line.split(separator).map(p => p.trim());
            const rowData = {};

            // 1. Extract Fixed Fields
            chipsBefore.forEach((fid, i) => rowData[fid] = parts[i]);
            chipsAfter.forEach((fid, i) => {
                const idx = parts.length - chipsAfter.length + i;
                if (idx >= 0 && idx < parts.length) rowData[fid] = parts[idx];
            });

            const featureTitle = rowData.title || 'Untitled Feature';
            let assigneeObj = null;
            if (rowData.assignee) assigneeObj = getAssignee(rowData.assignee);

            // 2. Iterate engineering steps (dynamic columns)
            phaseHeaders.forEach((phHeader, i) => {
                const colIdx = startDynIdx + i;
                const valStr = parts[colIdx];
                const est = parseFloat(valStr);

                if (!isNaN(est) && est > 0) {
                    const phase = phaseMap[phHeader];
                    const cost = est * multiplier;
                    const durationDays = Math.ceil(cost / 8);

                    // 3. Determine Start Date
                    // It should be after the last step of this row AND after the assignee's last task
                    let refDate = rowLastEnd[featureTitle] ? new Date(rowLastEnd[featureTitle]) : normalizeDate(project.start);

                    // Check assignee schedule
                    if (rowData.assignee && assigneeSchedule[rowData.assignee]) {
                        const personDate = new Date(assigneeSchedule[rowData.assignee]);
                        if (personDate > refDate) refDate = personDate;
                    }

                    let sDate = getNextBusinessDay(refDate, project.holidays);
                    if (!rowLastEnd[featureTitle] && !assigneeSchedule[rowData.assignee]) {
                        // First task in project/for person, use start date directly if it's biz day
                        sDate = new Date(refDate);
                        while (!isBusinessDay(sDate, project.holidays)) sDate.setDate(sDate.getDate() + 1);
                    }

                    const eDate = addBusinessDays(sDate, durationDays, project.holidays);

                    const newTask = {
                        id: generateId(),
                        title: featureTitle,
                        start: fmt(sDate),
                        end: fmt(eDate),
                        progress: 0,
                        estimate: cost,
                        assignee: assigneeObj || rowData.assignee || null,
                        status: rowData.status || 'todo'
                    };

                    phase.tasks.push(newTask);

                    // Update schedules
                    const lastDate = new Date(eDate);
                    rowLastEnd[featureTitle] = lastDate;
                    if (rowData.assignee) assigneeSchedule[rowData.assignee] = lastDate;
                }
            });
        });

        // Update Phase Ranges (critical since we might have added tasks to middle phases)
        project.phases.forEach(p => {
            if (p.tasks.length > 0) {
                // Initial calc
                let minDate = new Date(p.tasks[0].start);
                let maxDate = new Date(p.tasks[0].end);
                p.tasks.forEach(t => {
                    const s = new Date(t.start);
                    const e = new Date(t.end);
                    if (s < minDate) minDate = s;
                    if (e > maxDate) maxDate = e;
                });
                p.start = fmt(minDate);
                p.end = fmt(maxDate);

                // Ensure a milestone exists for each phase end
                const mName = p.name + ' End';
                let m = project.milestones.find(x => x.title === mName);
                if (!m) {
                    project.milestones.push({ id: generateId(), title: mName, date: p.end });
                } else {
                    m.date = p.end;
                }
            }
        });

        saveState();
        triggerRender();
        return;
    }

    // --- EXISTING FLAT IMPORT LOGIC ---
    lines.forEach(line => {
        const parts = line.split(separator).map(p => p.trim());
        const taskData = {};

        // Map parts to format
        format.forEach((fid, idx) => {
            if (idx < parts.length) {
                taskData[fid] = parts[idx];
            }
        });

        // 1. Determine Phase
        if (taskData.phase) {
            let p = project.phases.find(x => x.name === taskData.phase);
            if (!p) {
                p = { id: generateId(), name: taskData.phase, start: project.start, end: project.start, tasks: [], expanded: true };
                project.phases.push(p);
            }
            currentPhase = p;
        }
        if (!currentPhase) {
            // Create default
            currentPhase = { id: generateId(), name: 'Imported Phase', start: project.start, end: project.start, tasks: [], expanded: true };
            project.phases.push(currentPhase);
        }

        // 2. Task Details
        const title = taskData.title || 'Untitled';
        const estVal = parseFloat(taskData.estimate);
        const estimate = isNaN(estVal) ? 0 : estVal * multiplier;

        let assigneeObj = null;
        if (taskData.assignee) assigneeObj = getAssignee(taskData.assignee);

        // 3. Scheduling (Simple Auto-Schedule if dates missing)
        let sDateStr = taskData.start ? normalizeDate(taskData.start) : null;
        let eDateStr = taskData.end ? normalizeDate(taskData.end) : null;

        // If no start, try to auto-schedule after last task in phase or assignee
        if (!sDateStr) {
            // Find reference date (Phase Start or Last Task End)
            let refDate = normalizeDate(currentPhase.start);
            // Check assignee's last task?
            if (taskData.assignee && assigneeSchedule[taskData.assignee]) {
                const prevEnd = new Date(assigneeSchedule[taskData.assignee]);
                const nextStart = getNextBusinessDay(prevEnd, project.holidays);
                if (nextStart > refDate) refDate = nextStart;
            } else if (currentPhase.tasks.length > 0) {
                // Or schedule after last task in phase?
            }
            sDateStr = refDate;
            while (!isBusinessDay(sDateStr, project.holidays)) sDateStr.setDate(sDateStr.getDate() + 1);
        }

        // Calc End if missing
        if (!eDateStr) {
            const durationDays = estimate > 0 ? Math.ceil(estimate / 8) : 0;
            if (durationDays <= 0) eDateStr = new Date(sDateStr);
            else eDateStr = addBusinessDays(sDateStr, durationDays, project.holidays);
        }

        // Update Assignee Schedule
        if (taskData.assignee) assigneeSchedule[taskData.assignee] = new Date(eDateStr);

        const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

        const newTask = {
            id: generateId(),
            title: title,
            start: fmt(sDateStr),
            end: fmt(eDateStr),
            progress: 0,
            estimate: estimate,
            assignee: assigneeObj || taskData.assignee,
            status: taskData.status || 'todo',
            predecessors: taskData.predecessors ? taskData.predecessors.split(',') : []
        };

        currentPhase.tasks.push(newTask);
    });

    // Update Phase Ranges
    project.phases.forEach(p => {
        if (p.tasks.length > 0) {
            let minS = p.tasks[0].start;
            let maxE = p.tasks[0].end;
            p.tasks.forEach(t => {
                if (t.start < minS) minS = t.start;
                if (t.end > maxE) maxE = t.end;
            });
            p.start = minS;
            p.end = maxE;
        }
    });

    renderTimeline();
    renderWBS();
}




export function handleTaskDrop(src, tgt) {
    if (src.tid === tgt.tid) return;

    if (src.isPhase) {
        if (!tgt.isPhase) return;
        saveState();
        const sIdx = project.phases.findIndex(p => p.id === src.tid);
        const tIdx = project.phases.findIndex(p => p.id === tgt.tid);
        if (sIdx >= 0 && tIdx >= 0) {
            const [rem] = project.phases.splice(sIdx, 1);
            project.phases.splice(tIdx, 0, rem);
            triggerRender();
        }
        return;
    }

    if (tgt.isPhase) {
        saveState();
        const sP = project.phases.find(p => p.id === src.pid);
        const sList = findParentList(sP, src.tid);
        if (!sList) return;
        const sIdx = sList.findIndex(t => t.id === src.tid);
        const [movedTask] = sList.splice(sIdx, 1);

        const tP = project.phases.find(p => p.id === tgt.tid);
        if (tP) {
            tP.tasks.push(movedTask);
            tP.expanded = true;
        }
        triggerRender();
        return;
    }

    // Task -> Task
    saveState();
    const sP = project.phases.find(p => p.id === src.pid);
    const tP = project.phases.find(p => p.id === tgt.pid);

    const sList = findParentList(sP, src.tid);
    const tList = findParentList(tP, tgt.tid);

    if (sList && tList) {
        const sIdx = sList.findIndex(t => t.id === src.tid);
        const [movedTask] = sList.splice(sIdx, 1);

        let tIdx = tList.findIndex(t => t.id === tgt.tid);
        if (tIdx < 0) tIdx = tList.length;

        tList.splice(tIdx, 0, movedTask);
        triggerRender();
    }
}


export function closeFilterPopup() {
    if (activeFilterPopup) {
        activeFilterPopup.remove();
        activeFilterPopup = null;
    }
}

export function openFilterMenu(event, type) {
    event.stopPropagation();
    if (activeFilterPopup) { activeFilterPopup.remove(); activeFilterPopup = null; }

    const target = event.target.closest('.filter-icon');
    if (!target) return;
    const rect = target.getBoundingClientRect();

    const popup = document.createElement('div');
    popup.className = 'filter-popup';
    popup.style.top = `${rect.bottom + 5}px`;
    popup.style.left = `${rect.left}px`;

    const values = new Set();
    const collect = (list) => {
        list.forEach(t => {
            if (t.isPhase) {
                if (t.subtasks) collect(t.subtasks);
            } else {
                let val = '';
                if (type === 'title') val = t.title || '';
                if (type === 'assignee') val = t.assignee ? (t.assignee.name || t.assignee) : 'Unassigned';
                val = val.trim();
                if (val) values.add(val);
                if (t.subtasks) collect(t.subtasks);
            }
        });
    };

    const activePhases = project.phases.filter(p => selectedPhaseIds.includes(p.id));
    if (activePhases.length === 0 && project.phases.length > 0) {
        collect(project.phases[0].tasks || []);
    } else {
        activePhases.forEach(p => collect(p.tasks || []));
    }

    const roundedValues = Array.from(values).sort();

    popup.innerHTML = `
        <div style="padding:8px; border-bottom:1px solid #eee;">
            <input type="text" placeholder="Search..." class="filter-search-input" value="${wbsFilters[type]}" 
                   oninput="window.WBS_ACTION.wbsFilters['${type}'] = this.value.trim(); window.WBS_ACTION.renderWBS();">
        </div>
        <div class="filter-list">
            <div class="filter-item" onclick="window.WBS_ACTION.wbsFilters['${type}'] = ''; window.WBS_ACTION.renderWBS(); document.querySelector('.filter-search-input').value=''; window.WBS_ACTION.closeFilterPopup();">
                <i>(Clear Filter)</i>
            </div>
            ${roundedValues.map(v => `
                <div class="filter-item" onclick="window.WBS_ACTION.wbsFilters['${type}'] = '${escapeVal(v)}'; window.WBS_ACTION.renderWBS(); document.querySelector('.filter-search-input').value='${escapeVal(v)}'; window.WBS_ACTION.closeFilterPopup();">
                    ${v}
                </div>
            `).join('')}
        </div>
    `;

    document.body.appendChild(popup);
    activeFilterPopup = popup;

    setTimeout(() => {
        const closer = (e) => {
            if (!popup.contains(e.target) && e.target !== target) {
                popup.remove();
                activeFilterPopup = null;
                window.removeEventListener('click', closer);
            }
        };
        window.addEventListener('click', closer);
    }, 0);
}


export function addMilestoneInfo() {
    if (!project) return;
    showModal('Add Milestone', `<label>Title</label><input id="ms-t" class="modal-input"><label>Date</label><input id="ms-d" type="date" class="modal-input">`, () => {
        saveState();
        const t = document.getElementById('ms-t').value;
        const d = document.getElementById('ms-d').value;
        if (t && d) {
            project.milestones.push({ id: generateId(), title: t, date: d });
            triggerRender();
        }
    });
}

export function addPhaseInfo(phaseIdToEdit) {
    if (!project) return;

    let isEdit = false;
    let p = null;
    let title = 'Add Phase';
    let defName = '';
    let defStart = '';
    let defEnd = '';

    if (typeof phaseIdToEdit === 'string') {
        p = project.phases.find(ph => ph.id === phaseIdToEdit);
        if (p) {
            isEdit = true;
            title = 'Edit Phase';
            defName = p.name;
            defStart = p.start;
            defEnd = p.end;
        }
    }

    showModal(title,
        `<label>Name</label><input id="ph-n" class="modal-input" value="${escapeVal(defName)}">
         <div class="modal-row">
            <label>Start</label><input id="ph-s" type="date" class="modal-input" value="${defStart}">
            <label>End</label><input id="ph-e" type="date" class="modal-input" value="${defEnd}">
         </div>`,
        () => {
            saveState();
            const n = document.getElementById('ph-n').value;
            const s = document.getElementById('ph-s').value;
            const e = document.getElementById('ph-e').value;
            if (n && s && e) {
                if (isEdit && p) {
                    p.name = n;
                    p.start = s;
                    p.end = e;
                } else {
                    project.phases.push({ id: generateId(), name: n, start: s, end: e, tasks: [], expanded: true });
                    if (selectedPhaseIds.length === 0) setSelectedPhaseIds([project.phases[project.phases.length - 1].id]);
                }
                renderTimeline();
                renderWBS();
            }
        }
    );
}

// Custom Import State
let importFormat = ['title', 'estimate', 'assignee']; // Default
const availableFields = [
    { id: 'phase', label: 'Phase (Group)' },
    { id: 'title', label: 'Task Title' },
    { id: 'estimate', label: 'Estimate' },
    { id: 'assignee', label: 'Assignee' },
    { id: 'start', label: 'Start Date' },
    { id: 'end', label: 'End Date' },
    { id: 'status', label: 'Status' },
    { id: 'predecessors', label: 'Predecessors' },
    { id: 'phase_cols', label: 'Phase Columns (Auto)' },
    { id: 'ignore', label: '(Ignore Column)', title: 'Use this to skip a column in your text that you do not want to import.' }
];

export function openImportModal() {
    const renderBuilder = () => {
        const selectedHtml = importFormat.map((fid, idx) => {
            const f = availableFields.find(x => x.id === fid) || { id: fid, label: fid };
            return `<div class="format-chip" draggable="true" data-idx="${idx}" style="padding:4px 8px; background:var(--accent-color); color:white; border-radius:4px; cursor:grab; font-size:0.8rem; display:flex; align-items:center; gap:4px; position:relative; overflow:visible;">
                <span class="reorder-btn" onclick="moveFormatField(${idx}, -1)" style="cursor:pointer; font-size:0.7rem; background:rgba(0,0,0,0.2); padding:0 3px; border-radius:2px; user-select:none;">&larr;</span>
                <span style="flex:1;">${f.label}</span>
                <span class="reorder-btn" onclick="moveFormatField(${idx}, 1)" style="cursor:pointer; font-size:0.7rem; background:rgba(0,0,0,0.2); padding:0 3px; border-radius:2px; user-select:none;">&rarr;</span>
                <span onclick="removeFormatField(${idx})" style="cursor:pointer; opacity:0.8; font-weight:bold; margin-left:4px;">×</span>
            </div>`;
        }).join('<span style="color:var(--text-secondary);">&rarr;</span>');

        const availableHtml = availableFields
            .filter(f => f.id === 'ignore' || !importFormat.includes(f.id))
            .map(f => {
                return `<div class="field-chip" title="${f.title || ''}" onclick="addFormatField('${f.id}')" style="padding:4px 8px; border:1px solid var(--border-color); border-radius:4px; cursor:pointer; font-size:0.8rem; background:var(--bg-color); user-select:none;">${f.label}</div>`;
            }).join('');

        return `
            <div style="margin-bottom:1rem; border:1px solid var(--border-color); padding:0.5rem; border-radius:4px; background:var(--card-bg);">
                <label style="font-size:0.8rem; color:var(--text-secondary); display:block; margin-bottom:0.5rem;"><strong>1. Define Column Format</strong> (Click to add, Drag <b>or use &larr;&rarr;</b> to order)</label>
                
                <!-- Selected Format Area (Drop Target) -->
                <div id="format-drop-zone" style="min-height:30px; display:flex; flex-wrap:wrap; gap:0.5rem; align-items:center; padding:1rem; border:1px dashed var(--border-color); border-radius:4px; margin-bottom:0.5rem; background:var(--bg-color);">
                    ${selectedHtml}
                </div>

                <!-- Available Fields -->
                <div style="display:flex; flex-wrap:wrap; gap:0.5rem;">
                    ${availableHtml}
                </div>
            </div>

            <div style="margin-bottom:0.5rem;">
                <label style="font-size:0.8rem; color:var(--text-secondary); display:block; margin-bottom:0.5rem;"><strong>2. Paste Text</strong> (Tab separated, matches icons above)</label>
                <textarea id="import-text" style="width:100%;height:100px;font-family:monospace; white-space:pre;" placeholder="Phase A    Task 1    10    User1"></textarea>
            </div>

            <div style="display:flex; align-items:center; gap:1rem;">
                <div style="flex:1;">
                     <label style="font-size:0.8rem;">Unit:</label>
                     <select id="import-unit" class="modal-input" style="width:auto; padding:0.2rem;">
                        <option value="days">Person Days (8h/day)</option>
                        <option value="hours">Hours</option>
                    </select>
                </div>
                <button class="primary-btn" id="run-import-btn">Import</button>
            </div>
            
            <style>
                .field-chip:hover { background: var(--active-phase-row-bg) !important; border-color:var(--accent-color) !important; }
                .format-chip:active { cursor:grabbing; }
            </style>
        `;
    };

    // Helper functions for the modal interaction (attached to window for HTML onclicks)
    window.addFormatField = (fid) => {
        importFormat.push(fid);
        updateModal();
    };
    window.removeFormatField = (idx) => {
        importFormat.splice(idx, 1);
        updateModal();
    };
    window.moveFormatField = (idx, dir) => {
        const item = importFormat[idx];
        const newIdx = idx + dir;
        if (newIdx >= 0 && newIdx < importFormat.length) {
            importFormat.splice(idx, 1);
            importFormat.splice(newIdx, 0, item);
            updateModal();
        }
    };

    const getPlaceholder = () => {
        if (importFormat.length === 0) return "Paste your data here...";

        const row1 = [];
        const row2 = [];
        const row3 = [];

        importFormat.forEach(fid => {
            if (fid === 'phase_cols') {
                row1.push('Design', 'Dev', 'Test');
                row2.push('5', '10', '5');
                row3.push('3', '8', '4');
            } else {
                switch (fid) {
                    case 'phase': row1.push('Phase A'); row2.push('Phase A'); row3.push('Phase A'); break;
                    case 'title': row1.push('Task Title'); row2.push('Feature A'); row3.push('Feature B'); break;
                    case 'estimate': row1.push('8'); row2.push('8'); row3.push('4'); break;
                    case 'assignee': row1.push('Assignee'); row2.push('User1'); row3.push('User2'); break;
                    case 'start': row1.push('Start Date'); row2.push('2023-01-01'); row3.push('2023-01-01'); break;
                    case 'end': row1.push('End Date'); row2.push('2023-01-10'); row3.push('2023-01-10'); break;
                    case 'status': row1.push('Status'); row2.push('todo'); row3.push('todo'); break;
                    case 'predecessors': row1.push('Pre'); row2.push(''); row3.push(''); break;
                    case 'ignore': row1.push('...'); row2.push('...'); row3.push('...'); break;
                    default: row1.push('...'); row2.push('...'); row3.push('...');
                }
            }
        });

        return [row1.join('    '), row2.join('    '), row3.join('    ')].join('\n');
    };

    const updateModal = () => {
        const body = document.getElementById('modal-body');
        if (body) {
            // Save textarea state
            const txt = document.getElementById('import-text');
            const val = txt ? txt.value : '';

            body.innerHTML = renderBuilder();

            // Restore (or set placeholder if empty)
            const newTxt = document.getElementById('import-text');
            if (newTxt) {
                newTxt.placeholder = getPlaceholder();
                newTxt.value = val;
            }
            bindEvents();
        }
    };

    const bindEvents = () => {
        const btn = document.getElementById('run-import-btn');
        if (btn) btn.onclick = () => {
            const text = document.getElementById('import-text').value;
            const unit = document.getElementById('import-unit').value;
            if (text.trim()) importWBSFlat(text, unit, importFormat);
        };

        const zone = document.getElementById('format-drop-zone');
        if (!zone) return;

        let dragSrcEl = null;

        // Force allow drop on zone
        const allowDrop = (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
        };
        zone.ondragover = allowDrop;
        zone.ondragenter = allowDrop;

        zone.ondrop = (e) => {
            e.preventDefault();
            const srcIdx = parseInt(e.dataTransfer.getData('text/plain'));
            if (!isNaN(srcIdx)) {
                const item = importFormat[srcIdx];
                importFormat.splice(srcIdx, 1);
                importFormat.push(item);
                updateModal();
            }
        };

        const chips = zone.querySelectorAll('.format-chip');
        chips.forEach(chip => {
            chip.ondragstart = (e) => {
                dragSrcEl = chip;
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', chip.dataset.idx);
                setTimeout(() => chip.style.opacity = '0.4', 0);
            };
            chip.ondragend = () => { chip.style.opacity = '1'; dragSrcEl = null; };
            chip.ondragover = allowDrop;
            chip.ondragenter = (e) => {
                allowDrop(e);
                if (chip !== dragSrcEl) {
                    chip.style.transform = 'scale(1.1)';
                    chip.style.outline = '2px solid white';
                }
            };
            chip.ondragleave = () => {
                chip.style.transform = 'scale(1)';
                chip.style.outline = 'none';
            };
            chip.ondrop = (e) => {
                e.preventDefault();
                e.stopPropagation();

                const srcIdx = parseInt(e.dataTransfer.getData('text/plain'));
                const targetIdx = parseInt(chip.dataset.idx);

                if (!isNaN(srcIdx) && !isNaN(targetIdx) && srcIdx !== targetIdx) {
                    const item = importFormat[srcIdx];
                    importFormat.splice(srcIdx, 1);
                    importFormat.splice(targetIdx, 0, item);
                    updateModal();
                }
            };
        });
    };

    showModal('Custom Import', renderBuilder(), () => { });
    const txt = document.getElementById('import-text');
    if (txt) txt.placeholder = getPlaceholder();
    bindEvents();
}

export function importWBSFromText(text, unitStr) {
    saveState();
    const lines = text.trim().split('\n').map(l => l.trim()).filter(l => l);
    if (lines.length < 1) return;

    const multiplier = unitStr === 'days' ? 8 : 1;
    let separator = '\t';
    if (!lines[0].includes('\t')) separator = /\s{2,}/;
    let headers = lines[0].split(separator).map(h => h.trim()).filter(h => h);

    const assigneeSchedule = {};
    const getAssignee = (name) => {
        if (!project.assignees) project.assignees = [];
        let a = project.assignees.find(x => x.name === name);
        if (!a) {
            const color = DISTINCT_COLORS.find(c => !project.assignees.some(ex => ex.color === c)) || '#' + Math.floor(Math.random() * 16777215).toString(16);
            a = { id: generateId(), name: name, color: color };
            project.assignees.push(a);
            assigneeColors[name] = color;
        }
        return a;
    };

    let pendingTasks = [];
    lines.slice(1).forEach((line, rowIndex) => {
        const parts = line.split(separator).map(p => p.trim());
        if (parts.length < 2) return;
        const featureName = parts[0] || 'Untitled';
        let assigneeName = null;
        if (parts.length > headers.length + 1) assigneeName = parts[parts.length - 1];

        headers.forEach((phName, phaseIndex) => {
            const rawVal = parseFloat(parts[phaseIndex + 1]);
            const hours = isNaN(rawVal) ? 0 : rawVal * multiplier;
            pendingTasks.push({
                phaseIndex, rowIndex, phaseName: phName, title: featureName,
                estimate: hours, assigneeName
            });
        });
    });

    pendingTasks.sort((a, b) => {
        if (a.phaseIndex !== b.phaseIndex) return a.phaseIndex - b.phaseIndex;
        return a.rowIndex - b.rowIndex;
    });

    pendingTasks.forEach(item => {
        let phase = project.phases.find(p => p.name === item.phaseName);
        if (!phase) {
            phase = { id: generateId(), name: item.phaseName, start: project.start, end: project.start, tasks: [], expanded: true };
            project.phases.push(phase);
        }

        let assigneeObj = null;
        if (item.assigneeName) assigneeObj = getAssignee(item.assigneeName);

        const durationDays = item.estimate > 0 ? Math.ceil(item.estimate / 8) : 0;
        let sDate = normalizeDate(phase.start);
        while (!isBusinessDay(sDate, project.holidays)) sDate.setDate(sDate.getDate() + 1);

        if (item.assigneeName && assigneeSchedule[item.assigneeName]) {
            const prevEnd = new Date(assigneeSchedule[item.assigneeName]);
            const nextStart = getNextBusinessDay(prevEnd, project.holidays);
            if (nextStart > sDate) sDate = nextStart;
        }

        let eDate;
        if (durationDays <= 0) eDate = new Date(sDate);
        else eDate = addBusinessDays(sDate, durationDays, project.holidays);

        if (item.assigneeName) assigneeSchedule[item.assigneeName] = new Date(eDate);

        const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        phase.tasks.push({
            id: generateId(), title: item.title, start: fmt(sDate), end: fmt(eDate),
            progress: 0, estimate: item.estimate, assignee: assigneeObj
        });
    });

    project.phases.forEach(p => {
        if (p.tasks.length > 0) {
            let minS = p.tasks[0].start;
            let maxE = p.tasks[0].end;
            p.tasks.forEach(t => {
                if (t.start < minS) minS = t.start;
                if (t.end > maxE) maxE = t.end;
            });
            p.start = minS;
            p.end = maxE;

            // Auto-create milestone at phase end
            // Remove existing milestone for this phase end if any?
            // User requested "Create milestone at phase end date". 
            // Simple approach: just add it. Filters duplicates by title+date potentially?
            // Let's assume user scrubs data if broken.
            const msTitle = p.name + ' End';
            // Avoid adding if already exists (same day, same title)
            if (!project.milestones.some(m => m.title === msTitle && m.date === p.end)) {
                project.milestones.push({
                    id: generateId(),
                    title: msTitle,
                    date: p.end
                });
            }
        }
    });

    renderTimeline();
    renderWBS();
}



let isSyncingLeft = false;
let isSyncingRight = false;
function setupScrollSync() {
    const left = document.querySelector('.wbs-table-container');
    const right = document.querySelector('.wbs-gantt-container');
    if (!left || !right) return;

    if (left.dataset.syncAttached) return;

    left.dataset.syncAttached = 'true';
    right.dataset.syncAttached = 'true';

    left.addEventListener('scroll', () => {
        if (!isSyncingLeft) {
            isSyncingRight = true;
            right.scrollTop = left.scrollTop;
            setTimeout(() => isSyncingRight = false, 10);
        }
    });

    right.addEventListener('scroll', () => {
        if (!isSyncingRight) {
            isSyncingLeft = true;
            left.scrollTop = right.scrollTop;
            setTimeout(() => isSyncingLeft = false, 10);
        }
    });

    if (left.scrollTop !== right.scrollTop) {
        right.scrollTop = left.scrollTop;
    }
}


// --- SETTINGS MODALS ---

export function openAssigneeSettings() {
    const renderContent = () => {
        const listHtml = (project.assignees || []).map(a => `
            <div class="list-item" style="display:flex; justify-content:space-between; align-items:center;">
                <span style="display:flex; align-items:center;">
                    <span style="display:inline-block; width:12px; height:12px; background-color:${a.color}; border-radius:50%; margin-right:8px;"></span>
                    ${a.name}
                </span>
                <button class="danger-btn" onclick="deleteAssignee('${a.name}')">×</button>
            </div>
        `).join('');

        return `
            <div style="margin-bottom:1rem; display:flex; gap:0.5rem;">
                <input id="new-assignee-name" class="modal-input" placeholder="Name">
                <input type="color" id="new-assignee-color" value="#3b82f6" style="width:40px; height:32px; padding:0; border:none;">
                <button class="primary-btn" onclick="addAssignee()">Add</button>
            </div>
            <div class="list-container" style="max-height:300px; overflow-y:auto;">
                ${listHtml}
            </div>
        `;
    };

    showModal('Manage Assignees', renderContent(), () => {
        // Close callback (no confirm needed usually, changes are immediate or on add/del)
        renderWBS(); renderTimeline();
    });

    // We need to re-render content on add/delete, so we might need a way to refresh modal content.
    // showModal doesn't support live refresh easily without closing/opening or manual DOM manip.
    // Let's implement add/delete to refresh the modal if it's open.
}

export function addAssignee() {
    const nameInput = document.getElementById('new-assignee-name');
    const colorInput = document.getElementById('new-assignee-color');
    if (!nameInput || !nameInput.value) return;
    const name = nameInput.value;
    const color = colorInput.value;

    if (project.assignees.some(a => a.name === name)) { alert('Exists'); return; }

    saveState();
    project.assignees.push({ id: generateId(), name, color });
    syncAssigneeColors();

    // Refresh Modal
    openAssigneeSettings();
}

export function deleteAssignee(name) {
    if (!confirm(`Delete ${name}?`)) return;
    saveState();
    project.assignees = project.assignees.filter(a => a.name !== name);
    // Remove from tasks? Keep for history? Text remains but object ref gone.
    // Better to keep text or clear? Current logic just keeps text in tasks usually.
    // syncAssigneeColors handles it.
    syncAssigneeColors();
    openAssigneeSettings();
}

export function closeAssigneeSettings() {
    const overlay = document.getElementById('modal-overlay');
    if (overlay) overlay.classList.add('hidden');
    renderWBS(); renderTimeline();
}

export function openHolidayManager() {
    const renderContent = () => {
        const listHtml = (project.holidays || []).sort().map(h => `
            <div class="list-item" style="display:flex; justify-content:space-between; align-items:center;">
                <span>${formatDateWithDay(h)}</span>
                <button class="danger-btn" onclick="removeHoliday('${h}')">×</button>
            </div>
        `).join('');

        return `
             <div style="margin-bottom:1rem; display:flex; gap:0.5rem;">
                <input type="date" id="new-holiday-date" class="modal-input">
                <button class="primary-btn" id="add-holiday-btn">Add</button>
            </div>
            <div class="list-container" style="max-height:300px; overflow-y:auto;">
                ${listHtml}
            </div>
        `;
    };

    showModal('Manage Holidays', renderContent(), () => {
        renderWBS(); renderTimeline();
    });

    // Bind Add Button after modal is shown (showModal is sync/async render)
    setTimeout(() => {
        const btn = document.getElementById('add-holiday-btn');
        if (btn) {
            btn.onclick = () => {
                const dateInput = document.getElementById('new-holiday-date');
                if (dateInput && dateInput.value) {
                    saveState();
                    if (!project.holidays) project.holidays = [];
                    if (!project.holidays.includes(dateInput.value)) {
                        project.holidays.push(dateInput.value);
                        project.holidays.sort();
                    }
                    renderWBS(); renderTimeline(); // Instant Update
                    openHolidayManager(); // Refresh UI
                }
            };
        }
    }, 0);
}

export function removeHoliday(dateStr) {
    if (!project.holidays) return;
    saveState();
    project.holidays = project.holidays.filter(h => h !== dateStr);
    renderWBS(); renderTimeline(); // Instant Update
    openHolidayManager(); // Refresh UI
}



// --- INTERACTION ---


export let selectedRange = null; // { r1, c1, r2, c2 }

export function selectCell(r, c, extend = false) {
    if (r < 0) r = 0;

    // Normal Click: Clear Range, Set Anchor
    if (!extend) {
        selectedCell.r = r;
        selectedCell.c = c;
        selectionAnchor = { r, c };
        selectedRange = { r1: r, c1: c, r2: r, c2: c };
    } else {
        // Shift+Click: Extend from Anchor
        if (!selectionAnchor) selectionAnchor = { r: selectedCell.r, c: selectedCell.c };
        selectedCell.r = r;
        selectedCell.c = c;

        selectedRange = {
            r1: Math.min(selectionAnchor.r, r),
            c1: Math.min(selectionAnchor.c, c),
            r2: Math.max(selectionAnchor.r, r),
            c2: Math.max(selectionAnchor.c, c)
        };
    }

    updateSelectionVisuals();
}

export function updateSelectionVisuals() {
    // Clear old selection classes
    document.querySelectorAll('.selected-range').forEach(el => el.classList.remove('selected-range'));
    document.querySelectorAll('.selected-cell').forEach(el => el.classList.remove('selected-cell'));
    document.querySelectorAll('td[style*="outline"]').forEach(el => {
        el.style.outline = '';
        el.style.zIndex = '';
    });

    if (!selectedRange) return;

    // Highlight Range
    for (let r = selectedRange.r1; r <= selectedRange.r2; r++) {
        for (let c = selectedRange.c1; c <= selectedRange.c2; c++) {
            const el = document.querySelector(`td[data-row="${r}"][data-col="${c}"]`);
            if (el) el.classList.add('selected-range');
        }
    }

    // Highlight Active Cell (Cursor)
    const cursor = document.querySelector(`td[data-row="${selectedCell.r}"][data-col="${selectedCell.c}"]`);
    if (cursor) {
        cursor.classList.add('selected-cell');
        cursor.style.outline = '2px solid #3b82f6';
        cursor.style.zIndex = '10';
        cursor.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
}

export function moveSelection(dr, dc, extend = false) {
    const rows = document.querySelectorAll('.wbs-table tbody tr');
    if (!rows.length) return;
    const maxR = rows.length;

    let nr = selectedCell.r + dr;
    let nc = selectedCell.c + dc;

    if (nr < 0) nr = 0;
    if (nr >= maxR) nr = maxR - 1;
    if (nc < 0) nc = 0;
    if (nc > 10) nc = 10; // MAX_COLS

    selectCell(nr, nc, extend);

    // Scroll
    const row = rows[nr];
    if (row && row.children[nc]) {
        row.children[nc].scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
}

function setupSelectionEvents() {
    const table = document.getElementById('wbs-table-view');
    if (!table) return;

    let isDragging = false;

    table.addEventListener('mousedown', (e) => {
        const td = e.target.closest('td');
        if (!td) return;

        // Ignore inputs (let them focus)
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

        const r = parseInt(td.dataset.row);
        const c = parseInt(td.dataset.col);

        if (!isNaN(r) && !isNaN(c)) {
            isDragging = true;
            // Shift check handled in selectCell logic if we passed event, but here we want explicit drag start
            // If shift held, we extend. If not, we start new.
            selectCell(r, c, e.shiftKey);
        }
    });

    table.addEventListener('mouseover', (e) => {
        if (!isDragging) return;
        const td = e.target.closest('td');
        if (!td) return;

        const r = parseInt(td.dataset.row);
        const c = parseInt(td.dataset.col);

        if (!isNaN(r) && !isNaN(c)) {
            // Drag always extends from anchor
            selectCell(r, c, true);
        }
    });

    document.addEventListener('mouseup', () => {
        isDragging = false;
    });
}

export function enterEditMode() {
    if (isEditing) return;

    const el = document.querySelector(`td[data-row="${selectedCell.r}"][data-col="${selectedCell.c}"]`);
    if (el) {
        const input = el.querySelector('input, select, textarea');
        if (input) {
            isEditing = true;
            input.focus();
            if (input.select) input.select();
            input.addEventListener('blur', () => {
                setTimeout(() => isEditing = false, 100);
            }, { once: true });
        } else {
            const dateDiv = el.querySelector('.wbs-date-cell');
            if (dateDiv) dateDiv.click();
        }
    }
}

export function handleDeleteKey() {
    if (isEditing) return;
    if (selectedCell.c === 10) {
        const td = document.querySelector(`td[data-row="${selectedCell.r}"][data-col="10"]`);
        if (td) {
            const btn = td.querySelector('button.danger-btn');
            if (btn) btn.click();
        }
    }
}

// --- Event Setup for WBS (Splitter & Toolbar) ---
export function setupWBSEvents() {
    // 1. Toolbar Buttons
    const addPhaseBtn = document.getElementById('add-phase-btn');
    const addMilestoneBtn = document.getElementById('add-milestone-btn');

    if (addPhaseBtn) addPhaseBtn.onclick = () => window.addPhaseInfo();
    if (addMilestoneBtn) addMilestoneBtn.onclick = () => window.addMilestoneInfo();

    // 2. Splitter Drag
    const resizer = document.getElementById('wbs-resizer');
    const splitView = document.querySelector('.wbs-split-view');

    // 3. Selection Drag
    setupSelectionEvents();

    if (resizer && splitView) {
        let isResizing = false;

        resizer.addEventListener('mousedown', (e) => {
            isResizing = true;
            resizer.classList.add('active');
            document.body.style.cursor = 'col-resize';
            e.preventDefault(); // Prevent text selection
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;

            // Calculate new width relative to splitView
            const containerRect = splitView.getBoundingClientRect();
            const newWidth = e.clientX - containerRect.left;

            // Min/Max constraints
            if (newWidth > 50 && newWidth < containerRect.width - 50) {
                // Update grid template columns
                // 4px is resizer width
                splitView.style.gridTemplateColumns = `${newWidth}px 4px 1fr`;
            }
        });

        document.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                resizer.classList.remove('active');
                document.body.style.cursor = '';
            }
        });
    }
}


