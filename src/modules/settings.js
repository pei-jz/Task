import { project, saveState, assigneeColors } from './state.js';

export function setupSettingsTab() {
    const sidebarItems = document.querySelectorAll('.settings-menu-item');
    const contentArea = document.getElementById('settings-content');

    sidebarItems.forEach(item => {
        item.onclick = () => {
            sidebarItems.forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            const page = item.dataset.page;
            renderSettingsPage(page, contentArea);
        };
    });

    // Default
    renderSettingsPage('assignees', contentArea);
}

function renderSettingsPage(page, container) {
    container.innerHTML = '';
    if (!project) {
        container.innerHTML = '<p style="padding:2rem; text-align:center; color:var(--text-secondary);">No project loaded. Please create or load a project.</p>';
        return;
    }

    if (page === 'assignees') renderAssigneeSettings(container);
    else if (page === 'holidays') renderHolidaySettings(container);
}

function renderAssigneeSettings(container) {
    container.innerHTML = `
        <h3>Assignee Settings</h3>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:2rem;">
            <!-- List View -->
            <div>
                <h3>Manage Assignees</h3>
                 <div style="display:flex; gap:0.5rem; margin-bottom:1rem;">
                    <input id="set-assignee-name" class="modal-input" placeholder="Name" style="margin:0;">
                    <input id="set-assignee-color" type="color" value="#3b82f6" style="height:38px; padding:0; border:none; background:none;">
                    <button id="set-add-assignee-btn" class="primary-btn">Add</button>
                </div>
                <div id="set-assignee-list" style="border:1px solid var(--border-color); border-radius:8px; max-height:400px; overflow-y:auto; background:var(--bg-color);"></div>
            </div>

            <!-- Bulk Import -->
            <div>
                <h3>Bulk Import</h3>
                <p style="font-size:0.8rem; color:var(--text-secondary);">Enter one name per line.</p>
                <textarea id="set-assignee-bulk" class="modal-input" style="height:250px; resize:vertical;"></textarea>
                <div style="margin-top:0.5rem; display:flex; align-items:center; gap:0.5rem;">
                    <input type="checkbox" id="set-assignee-overwrite">
                    <label for="set-assignee-overwrite" style="font-size:0.9rem;">Overwrite existing</label>
                </div>
                <button id="set-assignee-bulk-save" class="primary-btn" style="width:100%; margin-top:0.5rem;">Import</button>
            </div>
        </div>
    `;

    // Logic
    const renderList = () => {
        const list = document.getElementById('set-assignee-list');
        list.innerHTML = (project.assignees || []).map(a => `
            <div style="padding:0.5rem 1rem; border-bottom:1px solid var(--border-color); display:flex; justify-content:space-between; align-items:center;">
                <div style="display:flex; align-items:center; gap:0.5rem;">
                    <div style="width:16px; height:16px; background:${a.color}; border-radius:4px;"></div>
                    <span>${a.name}</span>
                </div>
                <button class="danger-btn" onclick="window.deleteAssignee('${a.name}')">×</button>
            </div>
        `).join('');
        // We do NOT auto-populate bulk area anymore to avoid confusion, 
        // or we populate it but user knows append is default?
        // Let's populate it for reference.
        // document.getElementById('set-assignee-bulk').value = (project.assignees || []).map(a => a.name).join('\n');
    };

    renderList();

    // Add Single
    document.getElementById('set-add-assignee-btn').onclick = () => {
        const name = document.getElementById('set-assignee-name').value;
        const color = document.getElementById('set-assignee-color').value;
        if (name && !project.assignees.some(a => a.name === name)) {
            project.assignees.push({ name, color });
            assigneeColors[name] = color;
            saveState();
            renderList();
            document.getElementById('set-assignee-name').value = '';
        }
    };

    // Bulk Save
    document.getElementById('set-assignee-bulk-save').onclick = () => {
        const text = document.getElementById('set-assignee-bulk').value;
        const overwrite = document.getElementById('set-assignee-overwrite').checked;
        const lines = text.split('\n').map(l => l.trim()).filter(l => l);

        let newAssignees = overwrite ? [] : [...project.assignees];
        const usedNames = new Set(newAssignees.map(a => a.name));

        lines.forEach(name => {
            if (usedNames.has(name)) return;
            usedNames.add(name);
            // Assign random color
            const color = '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
            newAssignees.push({ name, color });
            assigneeColors[name] = color;
        });

        project.assignees = newAssignees;
        saveState();
        renderList();
        alert('Assignees updated!');
        document.getElementById('set-assignee-bulk').value = ''; // Clear after import
    };

    window.deleteAssignee = (name) => {
        const idx = project.assignees.findIndex(a => a.name === name);
        if (idx >= 0) {
            project.assignees.splice(idx, 1);
            saveState();
            renderList();
        }
    };
}

function renderHolidaySettings(container) {
    container.innerHTML = `
        <h2>Holiday Settings</h2>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:2rem;">
            <!-- List View -->
            <div>
                <h3>Manage Holidays</h3>
                <div style="display:flex; gap:0.5rem; margin-bottom:1rem;">
                    <input type="date" id="set-holiday-date" class="modal-input" style="margin:0;">
                    <button id="set-add-holiday-btn" class="primary-btn">Add</button>
                </div>
                <div id="set-holiday-list" style="border:1px solid var(--border-color); border-radius:8px; max-height:400px; overflow-y:auto; background:var(--bg-color);"></div>
            </div>

            <!-- Bulk Import -->
            <div>
                <h3>Bulk Import</h3>
                <p style="font-size:0.8rem; color:var(--text-secondary);">yyyy-mm-dd format, one per line.</p>
                <textarea id="set-holiday-bulk" class="modal-input" style="height:250px; resize:vertical;"></textarea>
                <div style="margin-top:0.5rem; display:flex; align-items:center; gap:0.5rem;">
                    <input type="checkbox" id="set-holiday-overwrite">
                    <label for="set-holiday-overwrite" style="font-size:0.9rem;">Overwrite existing</label>
                </div>
                <button id="set-holiday-bulk-save" class="primary-btn" style="width:100%; margin-top:0.5rem;">Import</button>
            </div>
        </div>
    `;

    const renderList = () => {
        const list = document.getElementById('set-holiday-list');
        const holidays = (project.holidays || []).sort();
        list.innerHTML = holidays.map(h => `
            <div style="padding:0.5rem 1rem; border-bottom:1px solid var(--border-color); display:flex; justify-content:space-between; align-items:center;">
                <span>${h}</span>
                <button class="danger-btn" onclick="window.removeHolidaySetting('${h}')">×</button>
            </div>
        `).join('');
    };
    renderList();

    document.getElementById('set-add-holiday-btn').onclick = () => {
        const val = document.getElementById('set-holiday-date').value;
        if (val && !project.holidays.includes(val)) {
            project.holidays.push(val);
            saveState();
            renderList();
            document.getElementById('set-holiday-date').value = '';
        }
    };

    document.getElementById('set-holiday-bulk-save').onclick = () => {
        const text = document.getElementById('set-holiday-bulk').value;
        const overwrite = document.getElementById('set-holiday-overwrite').checked;
        const lines = text.split('\n').map(l => l.trim()).filter(l => /^\d{4}-\d{2}-\d{2}$/.test(l));

        let newHolidays = overwrite ? [] : [...project.holidays];
        newHolidays = [...newHolidays, ...lines];

        project.holidays = [...new Set(newHolidays)].sort();
        saveState();
        renderList();
        alert('Holidays updated!');
        document.getElementById('set-holiday-bulk').value = '';
    };

    window.removeHolidaySetting = (h) => {
        project.holidays = project.holidays.filter(x => x !== h);
        saveState();
        renderList();
    };
}
