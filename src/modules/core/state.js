import { isTauri, invoke, generateId, normalizeDate } from '../utils/helpers.js';
import JSZip from 'jszip';
import { save, open, message } from '@tauri-apps/plugin-dialog';
import { getDefaultJapaneseHolidays } from '../utils/holidays.js';

export let project = null;
export let currentFilePath = null; // Track current file path
export let lastLoadedTime = 0; // Track the server/OS modified time when loaded to detect external changes

export async function updateWindowTitle(path) {
    const defaultTitle = "J.H Project Manager";
    let title = defaultTitle;

    if (path) {
        // Extract filename from path
        const filename = path.split('\\').pop().split('/').pop();
        title = `${filename} - ${defaultTitle}`;
    }

    // Update HTML title
    document.title = title;

    // Update Tauri Window title
    try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        await getCurrentWindow().setTitle(title);
    } catch (err) {
        console.warn("Could not set window title natively:", err);
    }
}

export function setProject(p) { project = p; }

export let theme = 'light';
export let viewMode = 'auto'; // 'auto', 'zoom'
export let zoomRange = null;
export function setZoomRange(z) { zoomRange = z; }
export function setViewMode(m) { viewMode = m; }

export let selectedPhaseIds = [];
export function setSelectedPhaseIds(ids) { selectedPhaseIds = ids; }

export let isAutoScheduleEnabled = true;
export function toggleAutoSchedule() {
    isAutoScheduleEnabled = !isAutoScheduleEnabled;
    triggerRender();
}

export let ganttZoomMode = 'day';
export function setGanttZoomMode(m) { ganttZoomMode = m; }

export function zoomGantt() {
    if (ganttZoomMode === 'day') ganttZoomMode = 'week';
    else if (ganttZoomMode === 'week') ganttZoomMode = 'month';
    else ganttZoomMode = 'day';
    triggerRender();
}

export async function resetData(name, start, end) {
    const d = new Date().toISOString().split('T')[0];
    await createNewProject(name || 'New Project', start || d, end || d);
    project.phases = [];
    currentFilePath = null; // Reset path on new
    lastLoadedTime = Date.now(); // Local initial time
    saveState();
    triggerRender();
}

export function getPixelsPerDay() {
    if (ganttZoomMode === 'month') return 15;
    if (ganttZoomMode === 'week') return 30;
    return 60; // day
}

export const assigneeColors = { 'Unassigned': '#cbd5e1' };

import { saveState, clearHistory, undo, redo } from './history.js';
export { saveState, clearHistory, undo, redo };

let _renderCallback = null;

export function onStateChange(cb) {
    _renderCallback = cb;
}
export { onStateChange as setRenderCallback };

export function triggerRender() {
    if (_renderCallback) _renderCallback();
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
            // Check for external modifications before saving
            if (path === currentFilePath) {
                try {
                    const currentDiskTime = await invoke('get_modified_time', { path: path });

                    if (currentDiskTime > lastLoadedTime) {
                        // File changed externally. Try to smart-merge.
                        const conflictState = await resolveConflictsSmartly(path);

                        // conflictState: 
                        // 'merged_clean' -> we pulled in safe remote changes, proceed to save.
                        // 'resolved_keep_local' -> user pushed through a hard conflict (or chose to overwrite).
                        // 'resolved_reload' -> user chose to discard changes. We reload and should NOT save.
                        // 'abort' -> user cancelled the save entirely.

                        if (conflictState === 'abort' || conflictState === 'resolved_reload') {
                            return; // Do not save
                        }

                        // If it merged cleanly (or user forced overwrite), we proceed to save the merged state.
                        // If silent auto-save was happening, a clean merge doesn't need to pop up a big modal, 
                        // but maybe we just log it or show a toast.
                    }
                } catch (e) {
                    console.warn('Could not check modified time', e);
                }
            }

            const zip = new JSZip();
            zip.file("project.json", JSON.stringify(project, (k, v) => k.startsWith('_') ? undefined : v, 2));
            const content = await zip.generateAsync({ type: "uint8array" });

            // Use Rust backend to save binary (native fs) to avoid scope issues
            await invoke('save_file', { path: path, content: Array.from(content) });

            currentFilePath = path;
            await updateWindowTitle(path);

            try {
                lastLoadedTime = await invoke('get_modified_time', { path: path }); // Update tracking time
            } catch (e) {
                lastLoadedTime = Date.now();
            }

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
                // Clean up any leaked ephemeral UI flags from old saves
                project.phases.forEach(p => {
                    Object.keys(p).forEach(k => { if (k.startsWith('_')) delete p[k]; });
                    const traverse = (list) => {
                        list.forEach(t => {
                            Object.keys(t).forEach(k => { if (k.startsWith('_')) delete t[k]; });
                            if (t.subtasks) traverse(t.subtasks);
                        });
                    };
                    if (p.tasks) traverse(p.tasks);
                });
            }

            currentFilePath = path;
            await updateWindowTitle(path);

            try {
                lastLoadedTime = await invoke('get_modified_time', { path: path });
            } catch (e) {
                lastLoadedTime = Date.now();
            }
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

export async function createNewProject(name, start, end) {
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
    currentFilePath = null;
    await updateWindowTitle(null);
    clearHistory();
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

export async function resolveConflictsSmartly(path) {
    try {
        const content = await invoke('read_file', { path: path });
        const zip = await JSZip.loadAsync(new Uint8Array(content));

        let remoteProject = null;
        if (zip.file("project.json")) {
            const text = await zip.file("project.json").async("text");
            remoteProject = JSON.parse(text);
        }

        if (!remoteProject) throw new Error("Could not parse remote format.");

        // Build Lookup map for remote
        const remoteMap = new Map();
        if (remoteProject.phases) {
            remoteProject.phases.forEach(p => {
                remoteMap.set(p.id, p);
                const traverse = (list) => {
                    list.forEach(t => { remoteMap.set(t.id, t); if (t.subtasks) traverse(t.subtasks); });
                };
                if (p.tasks) traverse(p.tasks);
            });
        }

        // Traverse Local and check against Remote
        // To also capture purely NEW remote tasks, we should actually iterate Remote,
        // and selectively merge into Local. Or, an easier mental model:
        // Start with a clone of Remote. 
        // For every item in Remote, if it exists in Local, check `updatedAt`.
        // If Local has it and Local is `isLocallyModified = updatedAt > lastLoadedTime`, overwrite the Remote one with the Local one.
        // Finally, for every item in Local that is NOT in Remote at all (meaning it was purely created locally), add it to the cloned Remote.
        // Then set project = clonedRemote.

        let hasSilentlyMerged = false;
        let hardConflicts = [];

        // Build Local lookup
        const localMap = new Map();
        project.phases.forEach(p => {
            localMap.set(p.id, p);
            const traverse = (list) => {
                list.forEach(t => { localMap.set(t.id, t); if (t.subtasks) traverse(t.subtasks); });
            };
            if (p.tasks) traverse(p.tasks);
        });

        const mergedPhases = [];

        // Parse through remote
        remoteProject.phases.forEach(rPhase => {
            const lPhase = localMap.get(rPhase.id);
            const isLocalModified = lPhase && lPhase.updatedAt && lPhase.updatedAt > lastLoadedTime;

            let finalPhase = null;

            if (lPhase) {
                if (rPhase.updatedAt > lPhase.updatedAt && !isLocalModified) {
                    // Safe update from remote
                    finalPhase = Object.assign({}, lPhase, rPhase); // Preserve local references but overwrite data
                    finalPhase._conflictHighlight = true;
                    hasSilentlyMerged = true;
                } else if (rPhase.updatedAt > lPhase.updatedAt && isLocalModified) {
                    // Collision
                    hardConflicts.push({ local: lPhase, remote: rPhase });
                    finalPhase = lPhase; // Fallback to local
                } else {
                    // Local is newer or same
                    finalPhase = lPhase;
                }
            } else {
                finalPhase = rPhase;
                finalPhase._conflictHighlight = true;
                hasSilentlyMerged = true;
            }

            if (finalPhase) {
                Object.keys(finalPhase).forEach(k => {
                    if (k.startsWith('_') && k !== '_conflictHighlight') {
                        delete finalPhase[k];
                    }
                });
            }

            // Now handle tasks for finalPhase
            const finalTasks = [];
            const rTasks = rPhase.tasks || [];

            rTasks.forEach(rTask => {
                const lTask = localMap.get(rTask.id);
                const isTaskLocalMod = lTask && lTask.updatedAt && lTask.updatedAt > lastLoadedTime;

                let finalTask = null;
                if (lTask) {
                    if (rTask.updatedAt > lTask.updatedAt && !isTaskLocalMod) {
                        finalTask = Object.assign({}, lTask, rTask);
                        // Only highlight if actual data changed, ignore pure timestamp updates
                        const lClean = { ...lTask }; delete lClean.updatedAt; delete lClean._conflictHighlight;
                        const rClean = { ...rTask }; delete rClean.updatedAt; delete rClean._conflictHighlight;
                        if (JSON.stringify(lClean) !== JSON.stringify(rClean)) {
                            finalTask._conflictHighlight = true;
                            hasSilentlyMerged = true;
                        }
                    } else if (rTask.updatedAt > lTask.updatedAt && isTaskLocalMod) {
                        // Collision - wait, are the contents identical?
                        const lClean = { ...lTask }; delete lClean.updatedAt; delete lClean._conflictHighlight;
                        const rClean = { ...rTask }; delete rClean.updatedAt; delete rClean._conflictHighlight;
                        if (JSON.stringify(lClean) !== JSON.stringify(rClean)) {
                            hardConflicts.push({ local: lTask, remote: rTask });
                        }
                        finalTask = lTask;
                    } else {
                        finalTask = lTask;
                    }
                } else {
                    finalTask = rTask;
                    finalTask._conflictHighlight = true;
                    hasSilentlyMerged = true;
                }

                if (finalTask) {
                    Object.keys(finalTask).forEach(k => {
                        if (k.startsWith('_') && k !== '_conflictHighlight') {
                            delete finalTask[k];
                        }
                    });
                }
                finalTasks.push(finalTask);
            });

            // Re-append purely local tasks that aren't in remote (user added them concurrently)
            if (lPhase && lPhase.tasks) {
                lPhase.tasks.forEach(lt => {
                    if (!rTasks.find(rt => rt.id === lt.id)) {
                        finalTasks.push(lt);
                    }
                });
            }

            finalPhase.tasks = finalTasks;
            mergedPhases.push(finalPhase);
        });

        // Add pure local phases
        project.phases.forEach(lp => {
            if (!remoteProject.phases.find(rp => rp.id === lp.id)) {
                mergedPhases.push(lp);
            }
        });

        // Apply back to project
        if (hardConflicts.length === 0) {
            project.phases = mergedPhases;
        }

        if (hardConflicts.length > 0) {
            // Need user input
            return await showConflictModal(path, hardConflicts);
        } else {
            // No hard conflicts. All remote changes (if any) applied cleanly.
            if (hasSilentlyMerged) {
                triggerRender();
                showToast("他ユーザーの変更情報を結合しました", 4000);
                setTimeout(() => {
                    // Clear green/red highlights
                    project.phases.forEach(p => {
                        delete p._conflictHighlight;
                        const traverse = (list) => {
                            list.forEach(t => { delete t._conflictHighlight; if (t.subtasks) traverse(t.subtasks); });
                        };
                        if (p.tasks) traverse(p.tasks);
                    });
                    triggerRender();
                }, 8000); // Wait 8 seconds instead of 5
            }
            return 'merged_clean';
        }

    } catch (err) {
        console.error("Conflict checking error:", err);
        const force = await confirm("Could not verify remote state. Force save anyway?");
        return force ? 'merged_clean' : 'abort';
    }
}

// Simple toast notification
function showToast(msg, duration = 3000) {
    const el = document.createElement('div');
    el.textContent = msg;
    el.style.position = 'fixed';
    el.style.bottom = '20px';
    el.style.right = '20px';
    el.style.backgroundColor = '#10b981'; // green
    el.style.color = '#fff';
    el.style.padding = '10px 20px';
    el.style.borderRadius = '5px';
    el.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)';
    el.style.zIndex = '999999';
    el.style.transition = 'opacity 0.3s ease';
    document.body.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; }, duration - 300);
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, duration);
}

// Modal specifically for hard conflicts
function showConflictModal(path, conflicts) {
    return new Promise((resolve) => {
        const modal = document.createElement('div');
        modal.style.position = 'fixed';
        modal.style.top = '0'; modal.style.left = '0'; modal.style.width = '100vw'; modal.style.height = '100vh';
        modal.style.backgroundColor = 'rgba(0,0,0,0.5)';
        modal.style.display = 'flex'; modal.style.alignItems = 'center'; modal.style.justifyContent = 'center';
        modal.style.zIndex = '99999';

        const box = document.createElement('div');
        box.style.backgroundColor = 'var(--card-bg, #fff)';
        box.style.color = 'var(--text-primary, #111827)';
        box.style.padding = '20px';
        box.style.borderRadius = '8px';
        box.style.maxWidth = '600px';
        box.style.boxShadow = '0 4px 6px -1px rgba(0, 0, 0, 0.1)';

        box.innerHTML = `
            <h3 style="margin-top:0; color:#ef4444;">⚠️ 重大な競合を検知しました</h3>
            <p>あなたと他のユーザーが<strong>全く同じタスク (${conflicts.length}件)</strong> を同時に編集しました。</p>
            <ul style="font-size:0.9em; color:var(--text-secondary); margin-bottom: 20px;">
                <li><strong>最新を読込（自分の変更を破棄）:</strong> 他のユーザーの編集を優先します。競合したタスクに加えた自分の編集は失われます。</li>
                <li><strong>強制更新（自分の変更で上書き）:</strong> 自分の編集を優先します。他のユーザーが競合タスクに加えた編集は失われます。</li>
            </ul>
            <p style="font-size:0.85em; color:#666;">※あなたが編集していない別のタスクに対する他ユーザーの変更は、どちらを選んでも安全に自動結合されます。</p>
            <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:20px;">
                <button id="btn-merge-reload" style="padding:8px 16px; background:#3b82f6; color:white; border:none; border-radius:4px; cursor:pointer;">最新を読込（自分の変更を破棄）</button>
                <button id="btn-merge-overwrite" style="padding:8px 16px; background:#ef4444; color:white; border:none; border-radius:4px; cursor:pointer;">強制更新（自分の変更で上書き）</button>
                <button id="btn-cancel" style="padding:8px 16px; background:transparent; color:var(--text-primary); border:1px solid #ccc; border-radius:4px; cursor:pointer;">キャンセル</button>
            </div>
        `;

        modal.appendChild(box);
        document.body.appendChild(modal);

        box.querySelector('#btn-merge-reload').onclick = async () => {
            document.body.removeChild(modal);
            // Re-apply the remote state to the hard conflicts
            conflicts.forEach(c => {
                Object.assign(c.local, c.remote);
                c.local._conflictHighlight = true;
            });
            triggerRender();
            // We want to save the new merged result to update timestamps
            resolve('merged_clean');
        };

        box.querySelector('#btn-merge-overwrite').onclick = () => {
            document.body.removeChild(modal);
            // Proceed to save, which natively uses the local state (our edits win)
            resolve('resolved_keep_local');
        };

        box.querySelector('#btn-cancel').onclick = () => {
            document.body.removeChild(modal);
            resolve('abort');
        };
    });
}
