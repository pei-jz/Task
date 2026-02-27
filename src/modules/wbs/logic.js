import { project } from '../core/state.js';
import { getNextBusinessDay, addBusinessDays, getBusinessDuration, isBusinessDay } from '../utils/dateCalc.js';
import { normalizeDate } from '../utils/helpers.js';

export function getTaskDepth(t, phases) {
    if (t.isPhase) return 0;
    return 0; // Handled by traversal in view/clipboard
}

export function shiftAssigneeTasks(changedTask, oldEndStr) {
    if (!changedTask || !changedTask.assignee) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let otherTasks = [];
    const collectTasks = (list) => {
        list.forEach(t => {
            if (!t.isPhase && t.assignee) {
                // Rule 1: Do not change dates for 'done' or 'doing' tasks
                if (t.status === 'done' || t.status === 'doing') return;

                const tStart = new Date(t.start);
                const tEnd = new Date(t.end);

                // Rule 2: Do not recalculate if the task is strictly in the past (both start and end)
                // Actually user requested "start or end in the past is not recalculated".
                // Let's interpret as: if it ends before today it's in the past. 
                // Or if it started before today to be safe, but usually we just don't shift tasks that are already "in flight" physically.
                // Let's exclude if end is in the past (already finished by date) or start is in the past (already started by date).
                if (tStart < today || tEnd < today) return;

                const assigneeName = (typeof t.assignee === 'object' && t.assignee.name) ? t.assignee.name : t.assignee;
                const targetName = (typeof changedTask.assignee === 'object' && changedTask.assignee.name) ? changedTask.assignee.name : changedTask.assignee;

                if (assigneeName === targetName && t.id !== changedTask.id && t.start && t.end) {
                    otherTasks.push(t);
                }
            }
            if (t.subtasks) collectTasks(t.subtasks);
        });
    };
    project.phases.forEach(p => {
        if (p.tasks) collectTasks(p.tasks);
    });

    otherTasks.sort((a, b) => new Date(a.start) - new Date(b.start));

    const oldEnd = new Date(oldEndStr);
    const newEnd = new Date(changedTask.end);

    // If newEnd is earlier, we don't necessarily "pull" tasks currently, we only push them.
    // If the changed task ended in the past, or changed to the past, it shouldn't push future tasks forward anyway 
    // unless the future task was previously starting *before* the new end. 

    // We only push downstream if the new end date pushes into them.
    if (newEnd <= oldEnd) return;

    let currentEnd = newEnd;

    otherTasks.forEach(t => {
        let tStart = new Date(t.start);

        // Rule 3: Only push tasks that are chronologically *after* or *overlapping* the task that changed.
        if (tStart >= oldEnd) {
            if (tStart < currentEnd) {
                let newStart = getNextBusinessDay(currentEnd, project.holidays);
                const duration = getBusinessDuration(t.start, t.end, project.holidays) || 1;
                const estDays = (t.estimate && t.estimate > 0) ? Math.ceil(t.estimate / 8) : duration;
                let pushedEnd = addBusinessDays(newStart, estDays, project.holidays);

                const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                t.start = fmt(newStart);
                t.end = fmt(pushedEnd);

                t._flashAuto = true;
                setTimeout(() => { if (t) delete t._flashAuto; const el = document.getElementById(`date-cell-${t.id}-start`); if (el) el.classList.remove('flash-update'); }, 4000);

                currentEnd = pushedEnd;
            } else {
                currentEnd = new Date(t.end);
            }
        }
    });
}

export function recalculatePhase(p) {
    if (!p) return;
    let minStart = null;
    let maxEnd = null;
    let totalEst = 0;
    let totalAct = 0;
    let allCount = 0;
    let doneCount = 0;

    const traverse = (list) => {
        let estSum = 0;
        let actSum = 0;
        list.forEach(t => {
            if (t.start) {
                const d = normalizeDate(t.start);
                if (d && (!minStart || d < minStart)) minStart = d;
            }
            if (t.end) {
                const d = normalizeDate(t.end);
                if (d && (!maxEnd || d > maxEnd)) maxEnd = d;
            }
            if (t.subtasks && t.subtasks.length > 0) {
                const subSums = traverse(t.subtasks);
                t.estimate = subSums.est;
                t.actualHours = subSums.act;
                estSum += subSums.est;
                actSum += subSums.act;
            } else {
                estSum += (parseFloat(t.estimate) || 0);
                actSum += (parseFloat(t.actualHours) || 0);
                allCount++;
                if (t.status === 'done') doneCount++;
            }
        });
        return { est: estSum, act: actSum };
    };

    if (p.tasks && p.tasks.length > 0) {
        const rootSums = traverse(p.tasks);
        totalEst = rootSums.est;
        totalAct = rootSums.act;
        const fmt = d => d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '';
        p.start = fmt(minStart);
        p.end = fmt(maxEnd);
        p.estimate = totalEst;
        p.actualHours = totalAct;
        p.progress = allCount === 0 ? 0 : Math.round((doneCount / allCount) * 100);
    } else {
        p.estimate = 0; p.actualHours = 0; p.progress = 0;
        p.start = p.start || ''; p.end = p.end || '';
    }
}

export function findParentOf(root, childId) {
    let found = null;
    const search = (node) => {
        if (!node.subtasks && !node.tasks) return;
        const list = node.subtasks || node.tasks;
        for (let t of list) {
            if (t.id === childId) { found = node; return; }
            search(t);
            if (found) return;
        }
    };
    search(root);
    return found;
}

export function findParentForLevel(ph, level) {
    if (level === 0) return ph;
    let curr = ph;
    let l = 0;
    while (l < level && curr) {
        let list = curr.subtasks || curr.tasks;
        if (!list || list.length === 0) return curr;
        curr = list[list.length - 1]; // last child
        l++;
    }
    return curr;
}
