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
    let clean = str.split('(')[0].trim();
    clean = clean.replace(/\./g, '-');
    const d = new Date(clean);
    if (isNaN(d.getTime())) return null;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
