import { normalizeDate } from './helpers.js';

export function isHoliday(d, holidays) {
    if (!holidays) return false;
    const s = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return holidays.includes(s);
}

export function isBusinessDay(d, holidays) {
    const day = d.getDay();
    if (day === 0 || day === 6) return false;
    if (isHoliday(d, holidays)) return false;
    return true;
}

export function getNextBusinessDay(date, holidays) {
    let d = new Date(date);
    d.setDate(d.getDate() + 1);
    while (!isBusinessDay(d, holidays)) {
        d.setDate(d.getDate() + 1);
    }
    return d;
}

export function addBusinessDays(startDate, durationDays, holidays) {
    let d = new Date(startDate);
    while (!isBusinessDay(d, holidays)) {
        d.setDate(d.getDate() + 1);
    }

    let remaining = Math.max(1, durationDays) - 1;
    while (remaining > 0) {
        d.setDate(d.getDate() + 1);
        if (isBusinessDay(d, holidays)) {
            remaining--;
        }
    }
    return d;
}

export function subtractBusinessDays(endDate, durationDays, holidays) {
    let d = new Date(endDate);
    while (!isBusinessDay(d, holidays)) {
        d.setDate(d.getDate() - 1);
    }

    let remaining = Math.max(1, durationDays) - 1;
    while (remaining > 0) {
        d.setDate(d.getDate() - 1);
        if (isBusinessDay(d, holidays)) {
            remaining--;
        }
    }
    return d;
}

export function calculateEndDateFromStart(startStr, estimateHours, holidays) {
    if (!startStr || !estimateHours) return null;
    const days = Math.ceil(estimateHours / 8);
    const startDate = normalizeDate(startStr);
    if (!startDate) return null;
    const end = addBusinessDays(startDate, days, holidays);
    return `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
}

export function calculateStartDateFromEnd(endStr, estimateHours, holidays) {
    if (!endStr || !estimateHours) return null;
    const days = Math.ceil(estimateHours / 8);
    const endDate = normalizeDate(endStr);
    if (!endDate) return null;
    const start = subtractBusinessDays(endDate, days, holidays);
    return `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
}

export function getBusinessDuration(startDate, endDate, holidays) {
    let count = 0;
    let d = new Date(startDate);
    const end = new Date(endDate);
    while (d <= end) {
        if (isBusinessDay(d, holidays)) count++;
        d.setDate(d.getDate() + 1);
    }
    return count;
}

export function getOverloadedAssignees(project) {
    const map = {};
    const traverse = (tasks) => {
        tasks.forEach(t => {
            const an = t.assignee ? (t.assignee.name || t.assignee) : null;
            if (an && t.start && t.end) {
                if (!map[an]) map[an] = [];
                map[an].push({ id: t.id, start: new Date(t.start), end: new Date(t.end) });
            }
            if (t.subtasks) traverse(t.subtasks);
        });
    };
    project.phases.forEach(p => traverse(p.tasks));

    const overloadedTaskIds = new Set();
    const overloadedAssignees = new Set();

    Object.keys(map).forEach(an => {
        const list = map[an].sort((a, b) => a.start - b.start);
        for (let i = 0; i < list.length - 1; i++) {
            for (let j = i + 1; j < list.length; j++) {
                if (list[j].start <= list[i].end) {
                    overloadedTaskIds.add(list[i].id);
                    overloadedTaskIds.add(list[j].id);
                    overloadedAssignees.add(an);
                } else {
                    break;
                }
            }
        }
    });

    return { taskIds: overloadedTaskIds, assignees: overloadedAssignees };
}
