export const isTauri = !!(window.__TAURI__);
export const invoke = isTauri ? window.__TAURI__.core.invoke : null;

export const DISTINCT_COLORS = ['#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#911eb4', '#46f0f0', '#f032e6', '#bcf60c', '#fabebe', '#008080', '#e6beff', '#9a6324', '#fffac8', '#800000', '#aaffc3', '#808000', '#ffd8b1', '#000075', '#808080'];

export function generateId() {
    return crypto.randomUUID();
}

export function normalizeDate(dStr) {
    if (!dStr) return null;
    let clean = String(dStr).split('(')[0].trim();
    clean = clean.replace(/\./g, '-');
    const parts = clean.split('-');
    if (parts.length >= 3) {
        return new Date(parts[0], parts[1] - 1, parts[2]);
    }
    const d = new Date(clean);
    if (isNaN(d.getTime())) return null;
    d.setHours(0, 0, 0, 0);
    return d;
}

export function escapeVal(v) {
    if (!v) return '';
    return String(v).replace(/'/g, "\\'");
}

export function getDayOfWeek(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const days = ['(日)', '(月)', '(火)', '(水)', '(木)', '(金)', '(土)'];
    return days[d.getDay()];
}

export function formatDateWithDay(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const w = getDayOfWeek(dateStr);
    return `${y}.${m}.${day}${w}`;
}

export function parseFormattedDate(str) {
    if (!str) return null;
    // Expected: yyyy.mm.dd(w) or yyyy-mm-dd
    let clean = str.split('(')[0].trim();
    clean = clean.replace(/\./g, '-');
    const d = new Date(clean);
    if (isNaN(d.getTime())) return null;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function isHoliday(d, holidays) {
    if (!holidays) return false;
    const s = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return holidays.includes(s);
}

export function isBusinessDay(d, holidays) {
    const day = d.getDay();
    if (day === 0 || day === 6) return false; // Sun, Sat
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
    // Find first business day if start is not (forward)
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
    // Find first business day if end is not (backward)
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
    // Simple loop
    while (d <= end) {
        if (isBusinessDay(d, holidays)) count++;
        d.setDate(d.getDate() + 1);
    }
    return count;
}

export function findTask(phase, tid) {
    if (!phase.tasks) return null;
    let found = null;
    const search = (list) => {
        for (let t of list) {
            if (t.id === tid) { found = t; return; }
            if (t.subtasks) search(t.subtasks);
            if (found) return;
        }
    };
    search(phase.tasks);
    return found;
}

export function findParentList(phase, tid) {
    if (!phase.tasks) return null;
    let foundList = null;
    const search = (list) => {
        for (let i = 0; i < list.length; i++) {
            if (list[i].id === tid) { foundList = list; return; }
            if (list[i].subtasks) search(list[i].subtasks);
            if (foundList) return;
        }
    };
    search(phase.tasks);
    return foundList;
}

export function ensureTaskProps(tasks) {
    tasks.forEach(t => {
        if (t.subtasks && t.subtasks.length > 0) {
            if (t.expanded === undefined) t.expanded = true;
            ensureTaskProps(t.subtasks);
        }
        if (!t.status) t.status = 'todo';
        if (t.actualHours === undefined) t.actualHours = 0;
    });
}

// NOTE: This function requires 'project' which is circular. 
// We should pass 'phases' or 'assignments' map directly if possible.
// Or just move this to wbs.js or state.js if it accesses global project deeply.
// Here it just needs project traversal. We can pass project as arg.
export function getOverloadedAssignees(project) {
    const map = {}; // Assignee -> [{id, start, end}]
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
