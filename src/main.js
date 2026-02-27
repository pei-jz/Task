
import {
    project, loadData, loadFile, saveData, resetData, undo, redo,
    zoomGantt, setRenderCallback, toggleTheme, initTheme,
    selectedPhaseIds, setSelectedPhaseIds, toggleAutoSchedule
} from './modules/core/state.js';
import {
    renderWBS, updateTask, updateTaskDate, toggleTask, togglePhase, initiateTaskDeletion,
    openAddTaskModal, selectCell, enterEditMode, moveSelection,
    openFilterMenu, closeFilterPopup,
    addMilestoneInfo, addPhaseInfo, openImportModal, importWBSFromText, exportWBSToHTML,
    setupWBSEvents, renderTimeline, getDateRange
} from './modules/wbs/index.js';
import {
    renderDashboard, toggleDashboardView, renderMiniDashboard
} from './modules/features/dashboard.js';
import { setupGlobalEvents } from './modules/wbs/events.js';
import { setupTabs } from './modules/ui/tabs.js';
import { showModal } from './modules/ui/modal.js';

// --- Global Exports (for inline HTML handlers) ---
window.updateTask = updateTask;
window.updateTaskDate = updateTaskDate;
window.toggleTask = toggleTask;
window.togglePhase = togglePhase;
window.deleteTaskWin = initiateTaskDeletion; // Keep old name for compatibility if needed, but map to new logic
window.openAddTaskModal = openAddTaskModal;
window.selectCell = selectCell;
window.openFilterMenu = openFilterMenu;
window.closeFilterPopup = closeFilterPopup;
window.addMilestoneInfo = addMilestoneInfo;
window.addPhaseInfo = addPhaseInfo;
window.openImportModal = openImportModal;
window.exportWBSToHTML = exportWBSToHTML;
// Deprecated settings window globals removed
window.toggleDashboardView = toggleDashboardView;
// window.enterEditMode = enterEditMode; // Maybe needed if double click handler in HTML uses it? YES.
window.enterEditMode = enterEditMode;
window.zoomGantt = zoomGantt;
window.undo = undo;
window.redo = redo;
window.saveData = saveData;
window.loadData = loadData; // Exposed for buttons? Yes.
window.resetData = resetData;
window.toggleTheme = toggleTheme;

// --- Initialization ---

setRenderCallback(() => {
    renderWBS();
    renderTimeline();
    renderMiniDashboard();

    const dashTab = document.getElementById('tab-dashboard');
    if (dashTab && dashTab.style.display !== 'none') {
        renderDashboard();
    }
});

window.addEventListener('DOMContentLoaded', async () => {
    setupTabs();
    setupGlobalEvents();
    setupWBSEvents();

    // Welcome Screen Buttons
    const startScreen = document.getElementById('start-screen');
    const hideStartScreen = () => {
        if (startScreen) startScreen.style.display = 'none';
        renderWBS();
        renderTimeline();
    };

    document.getElementById('start-new-btn')?.addEventListener('click', () => {
        // Simple prompt for now, or use showModal if we want consistent UI.
        // Given "押したさに、プロジェクト名の入力がなくなってます", user expects an input.
        // Let's use a modal or simple prompt. Since we have showModal in ui.js, let's use it for better UX?
        // Or just prompt() for speed to restore functionality precisely as requested (user implies it WAS there).
        // A simple prompt is safest to match "restore" expectation unless we know it was a modal.
        // Let's use `showModal` to be consistent with other "Add" UIs we built.

        showModal('Create New Project', `
            <label>Project Name</label>
            <input id="new-project-name" class="modal-input" value="New Project">
            <label>Start Date</label>
            <input id="new-project-start" type="date" class="modal-input" value="${new Date().toISOString().split('T')[0]}">
            <label>End Date</label>
            <input id="new-project-end" type="date" class="modal-input" value="${new Date().toISOString().split('T')[0]}">
        `, async () => {
            const name = document.getElementById('new-project-name').value;
            const start = document.getElementById('new-project-start').value;
            const end = document.getElementById('new-project-end').value;
            if (name && start && end) {
                await resetData(name, start, end);
                hideStartScreen();
            }
        });
    });

    document.getElementById('start-open-btn')?.addEventListener('click', async () => {
        const res = await loadData();
        if (res) hideStartScreen();
    });

    // Bind Toolbar Buttons
    document.getElementById('add-phase-btn')?.addEventListener('click', addPhaseInfo);
    // document.getElementById('add-milestone-btn')?.addEventListener('click', addMilestoneInfo); // Removed
    document.getElementById('execute-auto-schedule-btn')?.addEventListener('click', async () => {
        const { openBatchAutoScheduleModal } = await import('./modules/wbs/index.js');
        openBatchAutoScheduleModal();
    });
    // Deprecated header buttons removed
    document.getElementById('import-btn')?.addEventListener('click', openImportModal);
    document.getElementById('theme-toggle-btn')?.addEventListener('click', toggleTheme);
    document.getElementById('auto-schedule-toggle')?.addEventListener('change', toggleAutoSchedule);

    // Initial Render - Check if project exists to hide start screen?
    // Actually, we want to SHOW start screen by default if no project loaded.
    // await loadData(); // Don't auto-load default data, let user choose.

    // --- Initialization ---
    initTheme();

    // --- Startup File Association ---
    const listenForStartupFile = async () => {
        try {
            const { listen } = await import('@tauri-apps/api/event');
            const { getCurrentWindow } = await import('@tauri-apps/api/window');

            // Listen for files passed at startup (emitted from Rust setup)
            await listen('startup-file', async (event) => {
                const path = event.payload;
                if (path) {
                    try {
                        await loadFile(path);
                        hideStartScreen();
                    } catch (err) {
                        // If format is wrong, user wants to "terminate" (but in UI we just show error and stay at start)
                        // Actually let's follow user request: "エラーを表示し終了する"
                        // Since we can't easily kill the process from JS without a command, 
                        // we'll show the message and then exit if possible.
                        const { exit } = await import('@tauri-apps/plugin-process');
                        await exit(1);
                    }
                }
            });

            // Handle the case where the app is already running and a file is opened (Single Instance behavior)
            // But for now, we focus on launch association. 
            // In Tauri v2, we might need a command to check if there are initial args 
            // if the event was emitted before JS listener was ready.
            const { invoke } = await import('@tauri-apps/api/core');
            const initialPath = await invoke('get_initial_file');
            if (initialPath) {
                try {
                    await loadFile(initialPath);
                    hideStartScreen();
                } catch (err) {
                    const { exit } = await import('@tauri-apps/plugin-process');
                    await exit(1);
                }
            }
        } catch (e) {
            console.error('Failed to setup file listener', e);
        }
    };

    listenForStartupFile();

    // --- Shortcuts & Auto-Save ---
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            window.saveData(false); // false = manual save (might trigger dialog if no path, or save to path)
        }
    });

    let autoSaveTimer;
    window.triggerAutoSave = () => {
        clearTimeout(autoSaveTimer);
        const indicator = document.getElementById('save-indicator') || createSaveIndicator();
        indicator.textContent = 'Editing...';
        indicator.style.opacity = '1';

        autoSaveTimer = setTimeout(() => {
            indicator.textContent = 'Saving...';
            window.saveData(true).then(() => { // true = silent/auto
                indicator.textContent = 'Saved';
                setTimeout(() => { indicator.style.opacity = '0'; }, 2000);
            }).catch(err => {
                console.warn('Auto-save skipped/failed', err);
                indicator.style.opacity = '0';
            });
        }, 2000); // 2 seconds debounce
    };

    function createSaveIndicator() {
        const div = document.createElement('div');
        div.id = 'save-indicator';
        div.style.position = 'fixed';
        div.style.bottom = '20px';
        div.style.left = '20px';
        div.style.background = 'var(--card-bg)';
        div.style.color = 'var(--text-secondary)';
        div.style.padding = '5px 10px';
        div.style.borderRadius = '4px';
        div.style.fontSize = '0.8rem';
        div.style.boxShadow = '0 2px 5px rgba(0,0,0,0.1)';
        div.style.opacity = '0';
        div.style.transition = 'opacity 0.3s';
        div.style.zIndex = '1000';
        document.body.appendChild(div);
        return div;
    }
});
