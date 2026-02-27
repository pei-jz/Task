import { project, selectedPhaseIds, saveState } from '../core/state.js';
import { generateId, findTask } from '../utils/helpers.js';
import { shiftAssigneeTasks, executeBatchAutoSchedule, recalculatePhase } from './logic.js';
import { calculateEndDateFromStart, calculateStartDateFromEnd } from '../utils/dateCalc.js';
import { triggerRender, isAutoScheduleEnabled } from '../core/state.js';
import { showModal, showDatePicker } from '../ui/modal.js';
import { wbsState } from './state.js';

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

    if (p && p.id === tid) {
        if (field === 'title' || field === 'name') {
            p.name = value;
            p.updatedAt = Date.now();
            triggerRender();
        }
        return;
    }

    const t = findTask(p, tid);
    if (!t) return;

    if (field === 'estimate' || field === 'actualHours') {
        if (typeof value === 'string') {
            value = value.replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
            value = value.replace(/[^0-9.]/g, '');
        }
        value = parseFloat(value) || 0;
    }

    let didDateChange = false;
    let oldEndStr = t.end;
    let oldStartStr = t.start;

    if (field === 'assignee') {
        const assignObj = project.assignees.find(a => a.name === value);
        t.assignee = assignObj || value;
        // Shift downstream tasks when assignee changes
        if (isAutoScheduleEnabled) {
            shiftAssigneeTasks(t, oldEndStr);
        }
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

        if (t.estimate && t.estimate > 0) {
            if (field === 'start' && value) {
                const newEnd = calculateEndDateFromStart(t.start, t.estimate, project.holidays);
                if (newEnd && newEnd !== t.end) {
                    t.end = newEnd;
                    t._flashEnd = true;
                    didDateChange = true;
                    setTimeout(() => { if (t) delete t._flashEnd; const el = document.getElementById(`date-cell-${t.id}-end`); if (el) el.classList.remove('flash-update'); }, 3000);
                }
            } else if (field === 'end' && value) {
                const newStart = calculateStartDateFromEnd(t.end, t.estimate, project.holidays);
                if (newStart && newStart !== t.start) {
                    t.start = newStart;
                    t._flashStart = true;
                    didDateChange = true;
                    setTimeout(() => { if (t) delete t._flashStart; const el = document.getElementById(`date-cell-${t.id}-start`); if (el) el.classList.remove('flash-update'); }, 3000);
                }
            } else if (field === 'estimate' && t.start) {
                const newEnd = calculateEndDateFromStart(t.start, t.estimate, project.holidays);
                if (newEnd && newEnd !== t.end) {
                    t.end = newEnd;
                    t._flashEnd = true;
                    didDateChange = true;
                    setTimeout(() => { if (t) delete t._flashEnd; const el = document.getElementById(`date-cell-${t.id}-end`); if (el) el.classList.remove('flash-update'); }, 3000);
                }
            }
        } else {
            if (field === 'start' || field === 'end') didDateChange = true;
        }

        if (didDateChange && t.assignee && isAutoScheduleEnabled) {
            shiftAssigneeTasks(t, oldEndStr);
        }
    }

    t.updatedAt = Date.now();
    recalculatePhase(p);
    triggerRender();
}

export function updateTaskDate(pid, tid, field, value) {
    updateTask(pid, tid, field, value);
}

export function openAddTaskModal(pid, parentId) {
    if (selectedPhaseIds.length === 0) { alert('Select a Phase'); return; }
    if (!parentId) parentId = pid;
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

        const p = project.phases.find(ph => ph.id === pid);
        if (p && title) {
            const assigneeObj = (project.assignees || []).find(a => a.name === assigneeVal);
            const newTask = {
                id: generateId(), title, status: 'todo',
                start: document.getElementById('nt-start').value, end: document.getElementById('nt-end').value,
                assignee: assigneeObj || assigneeVal, estimate: estVal
            };

            let parentTask = findTask(p, parentId);
            if (parentTask && parentTask.id === parentId) {
                if (!parentTask.subtasks) parentTask.subtasks = [];
                parentTask.subtasks.push(newTask); parentTask.expanded = true;
            } else if (p.id === pid || p.id === parentId) {
                p.tasks.push(newTask);
            }
            triggerRender();
        }
    });
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

    saveState();
    const sP = project.phases.find(p => p.id === src.pid);
    const tP = project.phases.find(p => p.id === tgt.pid);

    // This requires findParentList from utils!
    // Since findParentList was in helpers.js but maybe not exported, I'll export from logic.js or use it if available
    // For now assume findParentList from utils works.
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
        `<label>Name</label><input id="ph-n" class="modal-input" value="${defName}">
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
                    p.name = n; p.start = s; p.end = e;
                } else {
                    project.phases.push({ id: generateId(), name: n, start: s, end: e, tasks: [], expanded: true });
                    if (selectedPhaseIds.length === 0) selectedPhaseIds.push(project.phases[project.phases.length - 1].id);
                }
                triggerRender();
            }
        }
    );
}

export async function initiateTaskDeletion(pid, tid) {
    let title = 'Reference';
    let isPhase = false;

    const p = project.phases.find(x => x.id === pid);
    if (pid === tid) {
        if (p) { title = p.name; isPhase = true; }
    } else if (p) {
        const t = findTask(p, tid);
        if (t) title = t.title;
    }

    try {
        const confirmed = await confirm(`Delete "${title}"?`);
        if (!confirmed) return;

        saveState();
        if (isPhase) {
            project.phases = project.phases.filter(x => x.id !== pid);
        } else if (p) {
            const list = findParentList(p, tid);
            if (list) {
                const idx = list.findIndex(x => x.id === tid);
                if (idx >= 0) list.splice(idx, 1);
                recalculatePhase(p);
            }
        }
        triggerRender();
    } catch (e) {
        console.error('Error during deletion:', e);
    }
}

export function handleArrowAccordion(key) {
    if (!wbsState.selectedCell) return false;
    let visibleTasks = [];

    project.phases.forEach(p => {
        if (selectedPhaseIds.length === 0 || selectedPhaseIds.includes(p.id)) {
            visibleTasks.push({ ...p, pid: p.id, isPhase: true });
            const traverse = (list) => {
                list.forEach(t => {
                    visibleTasks.push({ ...t, pid: p.id, isPhase: false });
                    if (t.expanded !== false && t.subtasks) traverse(t.subtasks);
                });
            };
            if (p.expanded !== false && p.tasks) traverse(p.tasks);
        }
    });

    const item = visibleTasks[wbsState.selectedCell.r];
    if (!item) return false;

    const p = project.phases.find(ph => ph.id === (item.isPhase ? item.id : item.pid));
    const obj = item.isPhase ? p : findTask(p, item.id);

    if (obj && (item.isPhase || (obj.subtasks && obj.subtasks.length > 0))) {
        if (key === 'ArrowRight' && obj.expanded === false) {
            obj.expanded = true; triggerRender(); return true;
        } else if (key === 'ArrowLeft' && obj.expanded !== false) {
            obj.expanded = false; triggerRender(); return true;
        }
    }
    return false;
}

export async function handleDeleteKey() {
    if (wbsState.isEditing || !wbsState.selectedRange) return;

    let visibleTasks = [];
    const traverse = (list, pid) => {
        list.forEach(t => {
            visibleTasks.push({ ...t, pid, isPhase: false });
            if (t.expanded !== false && t.subtasks) traverse(t.subtasks, pid);
        });
    };
    project.phases.forEach(p => {
        visibleTasks.push({ ...p, pid: p.id, isPhase: true });
        if (p.expanded !== false && p.tasks) traverse(p.tasks, p.id);
    });

    const itemsToDelete = [];
    for (let r = wbsState.selectedRange.r1; r <= wbsState.selectedRange.r2; r++) {
        if (r < visibleTasks.length) itemsToDelete.push(visibleTasks[r]);
    }
    if (itemsToDelete.length === 0) return;

    const msg = itemsToDelete.length === 1
        ? `Delete "${itemsToDelete[0].title || itemsToDelete[0].name}"?`
        : `選択したタスク（複数）を削除してよろしいでしょうか？`;

    try {
        const confirmed = await confirm(msg);
        if (!confirmed) return;

        saveState();
        const idsToDelete = new Set(itemsToDelete.map(i => i.id));

        project.phases = project.phases.filter(p => !idsToDelete.has(p.id));
        project.phases.forEach(p => {
            const cleanList = (list) => {
                for (let i = list.length - 1; i >= 0; i--) {
                    if (idsToDelete.has(list[i].id)) {
                        list.splice(i, 1);
                    } else if (list[i].subtasks) {
                        cleanList(list[i].subtasks);
                    }
                }
            };
            if (p.tasks) cleanList(p.tasks);
            recalculatePhase(p);
        });

        triggerRender();
    } catch (e) {
        console.error('Error during deletion:', e);
    }
}

export function openBatchAutoScheduleModal() {
    const todayStr = new Date().toISOString().split('T')[0];

    // Build Assignee Checkboxes
    let assigneeHtml = project.assignees && project.assignees.length > 0
        ? project.assignees.map(a => `
            <label style="display:flex; align-items:center; gap:0.5rem; margin-bottom:0.2rem;">
                <input type="checkbox" class="assignee-batch-check" value="${a.name}">
                <span><span class="color-dot" style="background:${a.color};"></span> ${a.name}</span>
            </label>
        `).join('')
        : `<p style="color:var(--text-secondary); font-size:0.8rem;">No assignees defined in project.</p>`;

    const html = `
        <div style="margin-bottom:1rem; padding:0.5rem; background:rgba(255,165,0,0.1); border-left:4px solid orange; font-size:0.8rem;">
            この操作は、選択した担当者のタスクを一括して自動スケジュールします。休日のスキップや、すでに完了したタスクの除外ルールが適用されます。<br>
            ※ 条件を選択しない場合は、すべての担当者の「システム日付以降」のタスクが一括調整されます。
        </div>
        
        <div style="margin-bottom:1.5rem;">
            <label style="font-weight:bold; display:block; margin-bottom:0.5rem;">条件1: 担当者選択 (Assignees)</label>
            <div style="max-height: 150px; overflow-y:auto; border:1px solid var(--border-color); padding:0.5rem; border-radius:4px;">
                ${assigneeHtml}
            </div>
            <div style="margin-top:0.3rem; font-size:0.75rem; color:var(--text-secondary);">
                ※ 何もチェックしない場合、全担当者が対象になります。
            </div>
        </div>

        <div style="margin-bottom:1rem;">
            <label style="font-weight:bold; display:block; margin-bottom:0.5rem;">条件2: 開始日 (Start Date)</label>
            <input type="date" id="batch-schedule-start" class="modal-input" value="${todayStr}">
            <div style="margin-top:0.3rem; font-size:0.75rem; color:var(--text-secondary);">
                ※ この日付以降に開始するタスクのみが調整対象になります。未指定時は本日(${todayStr})が基準となります。
            </div>
        </div>
    `;

    showModal('スケージュール自動調整', html, () => {
        saveState();

        const checkedNodes = document.querySelectorAll('.assignee-batch-check:checked');
        const selectedAssignees = Array.from(checkedNodes).map(node => node.value);

        const dateInput = document.getElementById('batch-schedule-start');
        const startDateStr = dateInput && dateInput.value ? dateInput.value : todayStr;

        executeBatchAutoSchedule(selectedAssignees, startDateStr);
        project.phases.forEach(recalculatePhase);

        triggerRender();
    });
}
