import { project, selectedPhaseIds, saveState, assigneeColors, ganttZoomMode, triggerRender, getPixelsPerDay } from '../core/state.js';
import { generateId, ensureTaskProps, findTask, escapeVal, DISTINCT_COLORS, formatDateWithDay, normalizeDate } from '../utils/helpers.js';
import { isHoliday, getOverloadedAssignees } from '../utils/dateCalc.js';
import { renderTimeline, getDateRange } from './gantt.js';
import { showModal, showDatePicker } from '../ui/modal.js';
import { recalculatePhase } from './logic.js';
import { wbsState } from './state.js';
import { updateTask, toggleTask, togglePhase, openAddTaskModal, updateTaskDate, addPhaseInfo, addMilestoneInfo, initiateTaskDeletion } from './actions.js';

let activeFilterPopup = null;
const MAX_COLS = 10;
const ROW_HEIGHT = 24;

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
                if (type === 'assignee') val = t.assignee ? (t.assignee.name || t.assignee) : 'Unassigned';
                else if (type === 'predecessors') val = (t.predecessors || []).join(',');
                else val = t[type] ?? '';

                val = String(val).trim();
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
            <input type="text" placeholder="Search..." class="filter-search-input" value="${wbsState.filters[type] || ''}" 
                   oninput="window.WBS_ACTION.setFilter('${type}', this.value.trim()); window.WBS_ACTION.renderWBS();">
        </div>
        <div class="filter-list">
            <div class="filter-item" onclick="window.WBS_ACTION.setFilter('${type}', ''); window.WBS_ACTION.renderWBS(); document.querySelector('.filter-search-input').value=''; window.WBS_ACTION.closeFilterPopup();">
                <i>(Clear Filter)</i>
            </div>
            ${roundedValues.map(v => `
                <div class="filter-item" onclick="window.WBS_ACTION.setFilter('${type}', '${escapeVal(v)}'); window.WBS_ACTION.renderWBS(); document.querySelector('.filter-search-input').value='${escapeVal(v)}'; window.WBS_ACTION.closeFilterPopup();">
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

// Ensure elements exist in window.WBS_ACTION for inline event handlers
function setupWBSActionGlobal() {
    window.WBS_ACTION = {
        renderWBS,
        togglePhase,
        toggleTask,
        openAddTaskModal,
        addPhaseInfo,
        addMilestoneInfo,
        deleteTaskWin: initiateTaskDeletion,
        updateTask,
        openFilterMenu,
        closeFilterPopup,
        setFilter: (type, val) => { wbsState.filters[type] = val; },
        pickDate: (pid, tid, field, currentVal) => {
            showDatePicker(currentVal, (newDate) => {
                updateTaskDate(pid, tid, field, newDate);
            }, project.holidays);
        },
        selectRow: (e, r) => {
            if (e) e.preventDefault();
            wbsState.selectionAnchor = { r: r, c: 0 };
            wbsState.selectedCell = { r: r, c: 0 };
            wbsState.selectedRange = { r1: r, c1: 0, r2: r, c2: 9 };
            // Will need to call updateSelectionVisuals here eventually, handled in events.js ideally, or exported
            triggerRender(); // Fallback for now
        }
    };
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

    if (left.scrollTop !== right.scrollTop) right.scrollTop = left.scrollTop;
}

export function renderWBS() {
    if (!project) return;

    setupWBSActionGlobal();
    project.phases.forEach(recalculatePhase);

    const tableView = document.getElementById('wbs-table-view');
    const ganttView = document.getElementById('wbs-gantt-view');
    if (!tableView || !ganttView) return;

    tableView.innerHTML = ''; ganttView.innerHTML = '';
    setupScrollSync();

    const renderMilestoneMarkers = (headerRow, minDate, maxDate, PIXELS_PER_DAY, DATE_HEADER_HEIGHT) => {
        if (!project.milestones) return;
        project.milestones.forEach(m => {
            const d = normalizeDate(m.date);
            if (d && d >= minDate && d <= maxDate) {
                const pxLeft = (d.getTime() - minDate.getTime()) / 86400000 * PIXELS_PER_DAY;
                const marker = document.createElement('div');
                marker.className = 'milestone-marker-header';
                marker.style.position = 'absolute';
                marker.style.left = `${pxLeft - 6}px`;
                marker.style.top = `${DATE_HEADER_HEIGHT + 5}px`;
                marker.title = `${m.title} (${m.date})`;
                headerRow.appendChild(marker);
            }
        });
    };

    const activePhases = project.phases;
    const isVisible = (t) => {
        if (t.isPhase) {
            const hasVisibleSub = t.subtasks && t.subtasks.some(st => isVisible(st));
            if (hasVisibleSub) return true;
            return Object.keys(wbsState.filters).length === 0 || Object.values(wbsState.filters).every(v => !v);
        }

        let selfMatch = true;
        for (const [key, val] of Object.entries(wbsState.filters)) {
            if (!val) continue;
            const filterStr = String(val).toLowerCase();
            let taskVal = '';
            if (key === 'assignee') taskVal = t.assignee ? (t.assignee.name || t.assignee) : 'Unassigned';
            else if (key === 'predecessors') taskVal = (t.predecessors || []).join(',');
            else taskVal = t[key] ?? '';

            taskVal = String(taskVal).toLowerCase();
            if (!taskVal.includes(filterStr)) {
                selfMatch = false;
                break;
            }
        }
        if (t.subtasks && t.subtasks.length > 0) return selfMatch || t.subtasks.some(st => isVisible(st));
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

    const columns = [
        { id: 'title', label: 'Task Name', width: 220 },
        { id: 'status', label: 'Status', width: 90 },
        { id: 'assignee', label: 'Assignee', width: 80 },
        { id: 'estimate', label: 'Est(h)', width: 60 },
        { id: 'start', label: 'Start', width: 125 },
        { id: 'end', label: 'End', width: 125 },
        { id: 'actualHours', label: 'Act(h)', width: 60 },
        { id: 'actualStart', label: 'Act.S', width: 100 },
        { id: 'actualEnd', label: 'Act.E', width: 100 },
        { id: 'predecessors', label: 'Pred.', width: 80 }
    ];

    const ths = columns.map((c, i) => {
        const isFirst = i === 0;
        const addBtn = isFirst ? `<button id="add-root-task-btn" class="subtask-btn" style="margin-left:8px;">+</button>` : '';
        const filterVal = wbsState.filters[c.id];
        const isActive = filterVal && String(filterVal).trim() !== '';
        const filterStyle = isActive ?
            `cursor:pointer; font-size:0.65rem; color:var(--accent-color); opacity:1; padding-left:2px; font-weight:bold;` :
            `cursor:pointer; font-size:0.65rem; opacity:0.5; padding-left:2px;`;

        return `
        <th style="width:${c.width}px; height:50px; padding: 0 4px;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <div style="display:flex; align-items:center; overflow:hidden;">
                    <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${c.label}">${c.label}</span>
                    ${addBtn}
                </div>
                <span class="filter-icon" onclick="window.WBS_ACTION.openFilterMenu(event, '${c.id}')" style="${filterStyle}">▼</span>
            </div>
        </th>`;
    }).join('');

    const table = document.createElement('table'); table.className = 'wbs-table';
    table.innerHTML = `<thead>
        <tr class="bg-gray-100 text-left text-xs text-gray-600 border-b" style="height:50px;">
            ${ths}
        </tr>
    </thead>`;
    const tbody = document.createElement('tbody');
    table.appendChild(tbody);

    const MONTH_HEADER_HEIGHT = 20;
    const DATE_HEADER_HEIGHT = 30;
    const HEADER_HEIGHT = 50;

    const { minDate, maxDate, totalTime } = getDateRange();
    const PIXELS_PER_DAY = getPixelsPerDay();
    const gCanvas = document.createElement('div'); gCanvas.className = 'wbs-gantt-canvas';

    const gGrid = document.createElement('div'); gGrid.style.position = 'absolute';
    gGrid.style.top = '0'; gGrid.style.height = '100%'; gGrid.style.width = '100%';

    const daysCount = totalTime / (1000 * 60 * 60 * 24);
    const visibleDays = Math.ceil((ganttView.clientWidth || 800) / PIXELS_PER_DAY);
    const extendDays = Math.max(0, visibleDays - daysCount + 5);
    const totalDrawDays = daysCount + extendDays;
    const totalCWidth = Math.max((ganttView.clientWidth || 800), totalDrawDays * PIXELS_PER_DAY);
    gCanvas.style.width = `${totalCWidth}px`;

    const headerRow = document.createElement('div');
    headerRow.style.position = 'sticky'; headerRow.style.top = '0';
    headerRow.style.height = `${HEADER_HEIGHT}px`; headerRow.style.width = '100%';
    headerRow.style.zIndex = '50'; headerRow.style.background = 'var(--card-bg)';
    headerRow.style.borderBottom = '1px solid var(--border-color)';
    gCanvas.appendChild(headerRow);

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

    renderMilestoneMarkers(headerRow, minDate, maxDate, PIXELS_PER_DAY, DATE_HEADER_HEIGHT);
    gCanvas.appendChild(gGrid);

    const gRowsContainer = document.createElement('div');
    gRowsContainer.className = 'gantt-rows-container';
    gRowsContainer.style.position = 'relative'; gRowsContainer.style.zIndex = '5';
    gCanvas.appendChild(gRowsContainer);

    let currentRowIndex = 0;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const { taskIds: overloadedIds } = getOverloadedAssignees(project);

    const svgLayer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svgLayer.style.position = 'absolute'; svgLayer.style.top = '0'; svgLayer.style.left = '0';
    svgLayer.style.width = '100%'; svgLayer.style.height = '100%'; svgLayer.style.pointerEvents = 'none'; svgLayer.style.zIndex = '4';
    gCanvas.insertBefore(svgLayer, gRowsContainer);

    // Call window.WBS_SELECTION if we moved those to another mod, else use inline logic.
    // For now inline events refer to selectCell on window if we export it. We'll add WBS_EVENTS global in events.js
    const renderTaskNode = (tasks, level, currentPhaseId) => {
        tasks.forEach(t => {
            if (!isVisible(t)) return;

            const tr = document.createElement('tr');
            tr.id = `row-${t.id}`; tr.dataset.tid = t.id;
            tr.style.height = `${ROW_HEIGHT}px`;
            if (t.isPhase) {
                tr.style.backgroundColor = 'var(--active-phase-row-bg)';
                tr.style.fontWeight = 'bold';
            } else if (t.status === 'done') {
                tr.className = 'task-done';
            } else if (t.end) {
                const eDate = new Date(t.end); eDate.setHours(0, 0, 0, 0);
                const plusTwo = new Date(today); plusTwo.setDate(plusTwo.getDate() + 2);

                if (eDate < today) {
                    tr.className = 'task-danger';
                } else if (eDate <= plusTwo) {
                    tr.className = 'task-warning';
                } else if (t.status === 'doing') {
                    tr.className = 'task-doing';
                }
            } else if (t.status === 'doing') {
                tr.className = 'task-doing';
            }
            if (t._conflictHighlight) {
                tr.style.outline = '2px solid #ef4444'; tr.style.outlineOffset = '-2px';
                tr.style.zIndex = '5'; tr.style.position = 'relative'; tr.title = 'Updated from another session';
            }

            const effectivePid = t.isPhase ? t.id : currentPhaseId;
            const indent = level * 16;
            const hasChildren = t.subtasks && t.subtasks.length > 0;
            const isExpanded = (t.expanded !== false);
            const toggleFn = t.isPhase ? `event.stopPropagation(); window.WBS_ACTION.togglePhase('${t.id}')` : `event.stopPropagation(); window.WBS_ACTION.toggleTask('${effectivePid}', '${t.id}')`;

            const td = (i, html) => {
                const isSel = wbsState.selectedCell.r === currentRowIndex && wbsState.selectedCell.c === i;
                const style = isSel ? 'padding:0; outline: 2px solid #3b82f6; z-index: 10;' : 'padding:0;';
                return `<td data-row="${currentRowIndex}" data-col="${i}" style="${style}" onclick="if(window.WBS_EVENTS) window.WBS_EVENTS.selectCell(${currentRowIndex}, ${i}, event && event.shiftKey)" ondblclick="if(window.WBS_EVENTS) window.WBS_EVENTS.enterEditMode()">${html}</td>`;
            };
            const dateCell = (pid, tid, field, val, isFlash) => {
                const disp = formatDateWithDay(val);
                const flashClass = isFlash ? 'flash-update' : '';
                return `<div id="date-cell-${tid}-${field}" class="wbs-date-cell ${flashClass}" onclick="event.stopPropagation(); window.WBS_ACTION.pickDate('${pid}','${tid}','${field}','${val}')" style="cursor:pointer; width:100%; height:100%; display:flex; align-items:center; padding:0 4px;">${disp}</div>`;
            };

            const handle = `<span class="drag-handle" onclick="event.stopPropagation(); window.WBS_ACTION.selectRow(event, ${currentRowIndex})" style="cursor:grab; color:#ccc; margin-right:4px; pointer-events:auto;">☰</span>`;
            const toggleHtml = hasChildren ? `<span class="task-toggle-btn" onclick="${toggleFn}" style="pointer-events:auto;">${isExpanded ? '▼' : '▶'}</span>` : `<span style="width:16px; margin-right:4px;"></span>`;
            const assigneeName = t.assignee ? (t.assignee.name || t.assignee) : '';
            const assignOpts = (project.assignees || []).map(a => `<option value="${a.name}" ${a.name === assigneeName ? 'selected' : ''}>${a.name}</option>`).join('');

            tr.innerHTML = `
                <td data-row="${currentRowIndex}" data-col="0" style="padding-left:0.5rem;" onclick="if(window.WBS_EVENTS) window.WBS_EVENTS.selectCell(${currentRowIndex}, 0, event && event.shiftKey)" ondblclick="if(window.WBS_EVENTS) window.WBS_EVENTS.enterEditMode()">
                    <div class="task-indent-wrapper" style="padding-left:${indent}px; pointer-events:none;">
                        ${handle} ${toggleHtml}
                        <input value="${t.title || t.name || ''}" onchange="window.WBS_ACTION.updateTask('${effectivePid}','${t.id}','${t.isPhase ? 'name' : 'title'}',this.value)" style="${t.isPhase || hasChildren ? 'font-weight:bold;' : ''} ${t.isPhase ? 'color: var(--text-primary);' : ''}">
                        ${t.isPhase ? '' : `<button class="subtask-btn" onclick="event.stopPropagation(); window.WBS_ACTION.openAddTaskModal('${effectivePid}', '${t.id}')" style="pointer-events:auto;">+</button>`}
                    </div>
                </td>
                ${td(1, t.isPhase ? '' : `<div style="text-align:center;"><select onchange="window.WBS_ACTION.updateTask('${effectivePid}','${t.id}','status',this.value)" class="status-${t.status || 'todo'}" style="width:90%; border-radius:4px;"><option value="todo" ${t.status === 'todo' ? 'selected' : ''}>To Do</option><option value="doing" ${t.status === 'doing' ? 'selected' : ''}>Doing</option><option value="done" ${t.status === 'done' ? 'selected' : ''}>Done</option></select></div>`)}
                ${td(2, t.isPhase ? '' : `<select onchange="window.WBS_ACTION.updateTask('${effectivePid}','${t.id}','assignee',this.value)" onkeydown="if(event.altKey && event.key==='ArrowDown'){if(this.showPicker)try{this.showPicker()}catch(e){}}" style="width:100%"><option value="">(Unassigned)</option>${assignOpts}</select>`)}
                ${td(3, t.isPhase ? `<div style="text-align:right; font-weight:normal; font-size: 0.9em; opacity: 0.8; padding-right: 12px;">${t.estimate || 0}</div>` : `<input type="text" value="${t.estimate || 0}" onchange="window.WBS_ACTION.updateTask('${effectivePid}','${t.id}','estimate',this.value)" style="width:100%; text-align:right; padding-right: 12px;">`)}
                ${td(4, t.isPhase ? `<span>${formatDateWithDay(t.start)}</span>` : dateCell(effectivePid, t.id, 'start', t.start, t._flashStart || t._flashAuto))}
                ${td(5, t.isPhase ? `<span>${formatDateWithDay(t.end)}</span>` : dateCell(effectivePid, t.id, 'end', t.end, t._flashEnd || t._flashAuto))}
                ${td(6, t.isPhase ? `<div style="text-align:right; font-weight:normal; font-size: 0.9em; opacity: 0.8; padding-right: 12px;">${t.actualHours || 0}</div>` : `<input type="text" value="${t.actualHours || 0}" onchange="window.WBS_ACTION.updateTask('${effectivePid}','${t.id}','actualHours',this.value)" style="width:100%; text-align:right; padding-right: 12px;">`)}
                ${td(7, t.isPhase ? '' : dateCell(effectivePid, t.id, 'actualStart', t.actualStart))}
                ${td(8, t.isPhase ? '' : dateCell(effectivePid, t.id, 'actualEnd', t.actualEnd))}
                ${td(9, t.isPhase ? '' : `<input type="text" value="${(t.predecessors || []).join(',')}" onchange="window.WBS_ACTION.updateTask('${effectivePid}','${t.id}','predecessors',this.value)" style="width:100%;">`)}
            `;

            // Drag Events
            if (window.WBS_EVENTS) {
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
                        window.WBS_EVENTS.handleTaskDropProxy(src, { pid: effectivePid, tid: t.id, isPhase: t.isPhase });
                    } catch (err) { }
                };
                tr.ondragend = () => { tr.classList.remove('dragging'); document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over')); };
            }

            tbody.appendChild(tr);

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

    project.phases.forEach(p => {
        const traverse = (t) => {
            if (t.predecessors && t.predecessors.length > 0) {
                const tgtBar = document.getElementById(`bar-${t.id}`);
                if (tgtBar) {
                    const pids = Array.isArray(t.predecessors) ? t.predecessors : String(t.predecessors).split(',');
                    pids.forEach(pid => {
                        const srcBar = document.getElementById(`bar-${pid.trim()}`);
                        if (srcBar) {
                            const srcRect = srcBar.getBoundingClientRect();
                            const tgtRect = tgtBar.getBoundingClientRect();
                            const canvasRect = gCanvas.getBoundingClientRect();

                            const x1 = srcRect.right - canvasRect.left + gCanvas.scrollLeft;
                            const y1 = srcRect.top - canvasRect.top + srcRect.height / 2;
                            const x2 = tgtRect.left - canvasRect.left + gCanvas.scrollLeft;
                            const y2 = tgtRect.top - canvasRect.top + tgtRect.height / 2;

                            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                            const dx = Math.abs(x2 - x1) / 2;
                            const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;

                            path.setAttribute('d', d);
                            path.setAttribute('stroke', 'var(--dependency-line-color)');
                            path.setAttribute('stroke-width', '2');
                            path.setAttribute('fill', 'none');
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

    tableView.onscroll = () => { ganttView.scrollTop = tableView.scrollTop; };
    ganttView.onscroll = () => { tableView.scrollTop = ganttView.scrollTop; };

    if (window.WBS_EVENTS && window.WBS_EVENTS.updateSelectionVisuals) {
        window.WBS_EVENTS.updateSelectionVisuals();
    }
}
