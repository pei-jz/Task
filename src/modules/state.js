import { isTauri, invoke, generateId, normalizeDate } from './helpers.js';
import JSZip from 'jszip';
// Note: Ensure @tauri-apps/plugin-dialog is installed
import { save, open, message } from '@tauri-apps/plugin-dialog';
import { getDefaultJapaneseHolidays } from './holidays.js';

export let project = null;
export let currentFilePath = null; // Track current file path
export function setProject(p) { project = p; }

export let theme = 'light';
export let viewMode = 'auto'; // 'auto', 'zoom'
export let zoomRange = null;
export function setZoomRange(z) { zoomRange = z; }
export function setViewMode(m) { viewMode = m; }

export let selectedPhaseIds = [];
export function setSelectedPhaseIds(ids) { selectedPhaseIds = ids; }

export let ganttZoomMode = 'day';
export function setGanttZoomMode(m) { ganttZoomMode = m; }

export function zoomGantt() {
    if (ganttZoomMode === 'day') ganttZoomMode = 'week';
    else if (ganttZoomMode === 'week') ganttZoomMode = 'month';
    else ganttZoomMode = 'day';
    triggerRender();
}

export function resetData(name, start, end) {
    const d = new Date().toISOString().split('T')[0];
    project = createNewProject(name || 'New Project', start || d, end || d);
    project.phases = [];
    currentFilePath = null; // Reset path on new
    saveState();
    triggerRender();
}

export function getPixelsPerDay() {
    if (ganttZoomMode === 'month') return 15;
    if (ganttZoomMode === 'week') return 30;
    return 60; // day
}

export const assigneeColors = { 'Unassigned': '#cbd5e1' };

// Undo/Redo
const undoStack = [];
const redoStack = [];
const MAX_HISTORY = 50;

let _renderCallback = null;

export function onStateChange(cb) {
    _renderCallback = cb;
}
export { onStateChange as setRenderCallback };

export function triggerRender() {
    if (_renderCallback) _renderCallback();
}

export function saveState() {
    if (!project) return;
    undoStack.push(JSON.parse(JSON.stringify(project)));
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack.length = 0;

    // Auto-save trigger
    if (window.triggerAutoSave) window.triggerAutoSave();

    // Check if we need to force update other views? 
    // toggleDashboardView in main does re-render if visible.
    // We assume renderCallback covers active view.
}

export function undo() {
    if (undoStack.length === 0) return;
    redoStack.push(JSON.parse(JSON.stringify(project)));
    project = undoStack.pop();
    triggerRender();
}

export function redo() {
    if (redoStack.length === 0) return;
    undoStack.push(JSON.parse(JSON.stringify(project)));
    project = redoStack.pop();
    triggerRender();
}

export function initTheme() {
    const savedTheme = localStorage.getItem('pm_theme');
    if (savedTheme) theme = savedTheme;
    applyTheme();
}

export function toggleTheme() {
    theme = (theme === 'light' ? 'dark' : 'light');
    localStorage.setItem('pm_theme', theme);
    applyTheme();
}

export function applyTheme() {
    document.documentElement.setAttribute('data-theme', theme);
    const btn = document.getElementById('theme-toggle-btn');
    if (btn) btn.textContent = (theme === 'light' ? '🌙' : '☀️');
}

export async function saveData(silent = false) {
    if (!project) return;

    try {
        let path = currentFilePath;

        if (!path) {
            if (silent) return; // Don't prompt logic for auto-save if never saved
            path = await save({
                filters: [{ name: 'WBS Project', extensions: ['wbs'] }]
            });
        }

        if (path) {
            const zip = new JSZip();
            zip.file("project.json", JSON.stringify(project, null, 2));
            const content = await zip.generateAsync({ type: "uint8array" });

            // Use Rust backend to save binary (native fs) to avoid scope issues
            await invoke('save_file', { path: path, content: Array.from(content) });

            currentFilePath = path;

            if (!silent) await message('Project saved successfully.', { title: 'Success', kind: 'info' });
        }
    } catch (err) {
        console.error('Save failed:', err);
        if (!silent) await message(`Save failed: ${err}`, { title: 'Error', kind: 'error' });
    }
}

export async function loadData() {
    try {
        const path = await open({
            filters: [{ name: 'WBS Project', extensions: ['wbs'] }]
        });

        if (path) {
            return await loadFile(path);
        }
    } catch (err) {
        console.error('Load failed:', err);
        await message(`Load failed: ${err}`, { title: 'Error', kind: 'error' });
    }
    return null;
}

export async function loadFile(path) {
    try {
        // Use Rust backend to read binary
        const content = await invoke('read_file', { path: path }); // Returns number[] (Vec<u8>)
        const zip = await JSZip.loadAsync(new Uint8Array(content));

        if (zip.file("project.json")) {
            const text = await zip.file("project.json").async("text");
            project = JSON.parse(text);

            if (!project.holidays) project.holidays = [];
            if (!project.assignees) project.assignees = [];
            syncAssigneeColors();

            if (project.phases) {
                selectedPhaseIds = project.phases.map(ph => ph.id);
            }

            currentFilePath = path;
            triggerRender();
            return project;
        } else {
            throw new Error("Invalid .wbs file: missing project.json or incompatible format.");
        }
    } catch (err) {
        console.error('File load failed:', err);
        await message(`Open failed. The file may be corrupted or in an unexpected format.\n\nError: ${err.message || err}`, { title: 'Format Error', kind: 'error' });
        // The user requested to exit if format is wrong, but in a desktop app, 
        // showing the error and remaining on the welcome screen is safer than forced exit.
        // However, if called during startup, we'll handle the "exit" or "show error" in main.js.
        throw err;
    }
}

export function syncAssigneeColors() {
    if (!project) return;
    // Keep Unassigned
    const unassignedColor = assigneeColors['Unassigned'];
    for (let k in assigneeColors) delete assigneeColors[k];
    assigneeColors['Unassigned'] = unassignedColor;

    project.assignees.forEach(a => {
        assigneeColors[a.name] = a.color;
    });
}

export function createNewProject(name, start, end) {
    project = {
        id: generateId(),
        name,
        start,
        end,
        phases: [],
        milestones: [],
        holidays: getDefaultJapaneseHolidays(),
        assignees: []
    };
    selectedPhaseIds = [];
    undoStack.length = 0; redoStack.length = 0;
    return project;
}

export function addDefaultPhasesToProject(names, sStr, eStr) {
    if (!project) return;
    const s = normalizeDate(sStr);
    const e = normalizeDate(eStr);
    const dur = e - s;

    const pDur = dur / names.length;
    let curr = new Date(s);
    const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    names.forEach(name => {
        const pStart = new Date(curr);
        const pEnd = new Date(curr.getTime() + pDur);
        project.phases.push({
            id: generateId(),
            name,
            start: fmt(pStart),
            end: fmt(pEnd),
            tasks: [],
            expanded: true
        });
        project.milestones.push({
            id: generateId(),
            title: name + ' End',
            date: fmt(pEnd)
        });
        curr = pEnd;
    });
}
