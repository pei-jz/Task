import { project } from '../core/state.js';
import { getNextBusinessDay, addBusinessDays, getBusinessDuration, isBusinessDay } from '../utils/dateCalc.js';
import { normalizeDate } from '../utils/helpers.js';

export function getTaskDepth(t, phases) {
    if (t.isPhase) return 0;
    return 0; // Handled by traversal in view/clipboard
}

export function executeBatchAutoSchedule(selectedAssignees, startDateString) {
    const targetDate = new Date(startDateString);
    targetDate.setHours(0, 0, 0, 0);

    const tasksByAssignee = {};

    const collectTasks = (list) => {
        list.forEach(t => {
            if (!t.isPhase && t.assignee) {
                if (t.status === 'done' || t.status === 'doing') return;

                const tStart = new Date(t.start);
                const assigneeName = (typeof t.assignee === 'object' && t.assignee.name) ? t.assignee.name : t.assignee;

                // Apply Assignee Filter (if selectedAssignees array is empty, all are valid)
                if (selectedAssignees.length === 0 || selectedAssignees.includes(assigneeName)) {
                    if (!tasksByAssignee[assigneeName]) tasksByAssignee[assigneeName] = [];
                    tasksByAssignee[assigneeName].push(t);
                }
            }
            if (t.subtasks) collectTasks(t.subtasks);
        });
    };

    project.phases.forEach(p => {
        if (p.tasks) collectTasks(p.tasks);
    });

    const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    Object.values(tasksByAssignee).forEach(tasks => {
        // Sort chronologically
        tasks.sort((a, b) => new Date(a.start) - new Date(b.start));

        if (tasks.length === 0) return;

        let currentEnd = null;

        tasks.forEach(t => {
            let tStart = new Date(t.start);

            // Adjust start to be at least targetDate if it's a To Do task
            if (tStart < targetDate) {
                tStart = new Date(targetDate);
            }

            // If we have a previous task's end, ensure this one starts after it
            if (currentEnd && tStart <= currentEnd) {
                tStart = getNextBusinessDay(currentEnd, project.holidays);
            }

            const newStartStr = fmt(tStart);
            const duration = getBusinessDuration(t.start, t.end, project.holidays) || 1;
            const estDays = (t.estimate && t.estimate > 0) ? Math.ceil(t.estimate / 8) : duration;
            let pushedEnd = addBusinessDays(tStart, estDays, project.holidays);

            if (t.start !== newStartStr) {
                t.start = newStartStr;
                t.end = fmt(pushedEnd);

                t._flashAuto = true;
                setTimeout(() => {
                    if (t) delete t._flashAuto;
                    const elStart = document.getElementById(`date-cell-${t.id}-start`);
                    const elEnd = document.getElementById(`date-cell-${t.id}-end`);
                    if (elStart) elStart.classList.remove('flash-update');
                    if (elEnd) elEnd.classList.remove('flash-update');
                }, 4000);
            }

            currentEnd = pushedEnd;
        });
    });
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

                // Rule 2: In the past we don't shift only if it is already finished or started.
                // If it is 'To Do', we should allow it to be shifted to the future.
                // However, if the user explicitly wants to keep "historical" records, we check today.
                // Let's allow shifting 'To Do' tasks even if they were scheduled in the past.
                if (t.status === 'done' || t.status === 'doing') return;

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

    // Determine if we are pushing tasks forward or pulling them back
    // The user requested to "auto-adjust schedule". If a task's start/end changes, 
    // downstream tasks by the same assignee should ideally follow tightly but not overlap.
    // For simplicity, we just line them up sequentially after the changed task, 
    // starting from the new end date.

    // If the changed task is now completely in the past, or its new end is before today,
    // we should still shift future tasks to start after it if they were previously scheduled after it.
    let currentEnd = newEnd;

    otherTasks.forEach(t => {
        let tStart = new Date(t.start);

        // Rule 3: Only push/pull tasks that are chronologically *after* or *overlapping* the task that changed.
        // We define this as: if the task originally started ON or AFTER the old end date of the changed task,
        // or if it overlaps with the new end date.
        // Actually, the simplest standard WBS logic for "same assignee" is to just sequentially chain them 
        // if they overlap, or if they were previously chained.
        // Let's rely on overlap detection or being strictly subsequent.

        if (tStart >= oldEnd || tStart <= currentEnd) {
            let newStart = getNextBusinessDay(currentEnd, project.holidays);

            // If the calculated new start is actually different from current start, shift it
            const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            const newStartStr = fmt(newStart);

            if (t.start !== newStartStr) {
                const duration = getBusinessDuration(t.start, t.end, project.holidays) || 1;
                const estDays = (t.estimate && t.estimate > 0) ? Math.ceil(t.estimate / 8) : duration;
                let pushedEnd = addBusinessDays(newStart, estDays, project.holidays);

                t.start = newStartStr;
                t.end = fmt(pushedEnd);

                t._flashAuto = true;
                setTimeout(() => {
                    if (t) delete t._flashAuto;
                    const elStart = document.getElementById(`date-cell-${t.id}-start`);
                    const elEnd = document.getElementById(`date-cell-${t.id}-end`);
                    if (elStart) elStart.classList.remove('flash-update');
                    if (elEnd) elEnd.classList.remove('flash-update');
                }, 4000);

                currentEnd = pushedEnd;
            } else {
                currentEnd = new Date(t.end);
            }
        } else {
            // If it's far in the future and doesn't overlap, just leave it alone but update currentEnd
            currentEnd = new Date(Math.max(currentEnd.getTime(), new Date(t.end).getTime()));
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
