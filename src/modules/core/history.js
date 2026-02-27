import { project, setProject, triggerRender } from './state.js';

const undoStack = [];
const redoStack = [];
const MAX_HISTORY = 50;

export function saveState() {
    if (!project) return;
    undoStack.push(JSON.parse(JSON.stringify(project)));
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack.length = 0;

    // Auto-save trigger
    if (window.triggerAutoSave) window.triggerAutoSave();
}

export function undo() {
    if (undoStack.length === 0) return;
    redoStack.push(JSON.parse(JSON.stringify(project)));
    setProject(undoStack.pop());
    triggerRender();
}

export function redo() {
    if (redoStack.length === 0) return;
    undoStack.push(JSON.parse(JSON.stringify(project)));
    setProject(redoStack.pop());
    triggerRender();
}

export function clearHistory() {
    undoStack.length = 0;
    redoStack.length = 0;
}
