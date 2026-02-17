import { project } from './state.js';
import { getDateRange } from './gantt.js';

export function renderDashboard() {
    if (!project) return;
    const container = document.querySelector('.dashboard-grid');
    if (!container) return;
    container.innerHTML = '';

    const totalTasks = countTasks(project.phases);
    const completedTasks = countCompletedTasks(project.phases);
    const progress = totalTasks === 0 ? 0 : Math.round((completedTasks / totalTasks) * 100);
    const delayedTasks = countDelayedTasks(project.phases);
    const { minDate, maxDate } = getDateRange();

    let dateRangeStr = '-';
    if (minDate && maxDate) {
        dateRangeStr = `${minDate.toLocaleDateString()} - ${maxDate.toLocaleDateString()}`;
    }

    // Card 1: Overview
    const overviewCard = document.createElement('div'); overviewCard.className = 'dash-card';
    overviewCard.innerHTML = `
        <h3>Project Overview</h3>
        <div class="stat-item"><span>Schedule:</span> <span class="stat-value">${dateRangeStr}</span></div>
        <div class="stat-item"><span>Total Tasks:</span> <span class="stat-value">${totalTasks}</span></div>
        <div class="stat-item"><span>Completed:</span> <span class="stat-value">${completedTasks}</span></div>
        <div class="stat-item"><span>Overall Progress:</span> <span class="stat-value">${progress}%</span></div>
        <div class="progress-bar-bg"><div class="progress-bar-fill" style="width:${progress}%"></div></div>
    `;
    container.appendChild(overviewCard);

    // Card 2: Status
    const statusCard = document.createElement('div'); statusCard.className = 'dash-card';
    statusCard.innerHTML = `
        <h3>Health Check</h3>
        <div class="stat-item"><span>Delayed Tasks:</span> <span class="stat-value" style="color:${delayedTasks > 0 ? '#ef4444' : 'inherit'}">${delayedTasks}</span></div>
        <div class="stat-item"><span>Phases:</span> <span class="stat-value">${project.phases.length}</span></div>
        <div class="stat-item"><span>Milestones:</span> <span class="stat-value">${project.milestones.length}</span></div>
    `;
    container.appendChild(statusCard);

    // Card 3: Phase Health
    const phaseStats = getPhaseStats(project.phases);
    const phaseCard = document.createElement('div'); phaseCard.className = 'dash-card';
    phaseCard.innerHTML = `<h3>Phase Health</h3>`;
    const pTable = document.createElement('table'); pTable.className = 'assignee-table';
    pTable.innerHTML = `<thead><tr><th>Phase</th><th>Total</th><th>Delayed</th></tr></thead><tbody></tbody>`;
    const pBody = pTable.querySelector('tbody');
    phaseStats.forEach(p => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${p.title}</td><td>${p.total}</td><td style="color:${p.delayed > 0 ? '#ef4444' : 'inherit'}">${p.delayed}</td>`;
        pBody.appendChild(tr);
    });
    phaseCard.appendChild(pTable);
    container.appendChild(phaseCard);

    // Card 4: Assignee Workload
    const assigneeStats = getAssigneeStats();
    const assigneeCard = document.createElement('div'); assigneeCard.className = 'dash-card';
    assigneeCard.innerHTML = `<h3>Assignee Workload</h3>`;
    const table = document.createElement('table'); table.className = 'assignee-table';
    table.innerHTML = `<thead><tr><th>Name</th><th>Total</th><th>Due Today</th><th>Done</th><th>Delayed</th></tr></thead><tbody></tbody>`;
    const tbody = table.querySelector('tbody');
    assigneeStats.forEach(a => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${a.name}</td><td>${a.total}</td><td>${a.planned}</td><td>${a.done}</td><td style="color:${a.delayed > 0 ? '#ef4444' : 'inherit'}">${a.delayed}</td>`;
        tbody.appendChild(tr);
    });
    assigneeCard.appendChild(table);
    container.appendChild(assigneeCard);
}

function getPhaseStats(phases) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return phases.map((p, i) => {
        let total = 0;
        let delayed = 0;
        const traverse = (tasks) => {
            tasks.forEach(t => {
                total++;
                if (t.end) {
                    const e = new Date(t.end);
                    if (e < today && t.progress < 100) delayed++;
                }
                if (t.subtasks) traverse(t.subtasks);
            });
        };
        traverse(p.tasks);
        return { title: p.name || `Phase ${i + 1}`, total, delayed };
    });
}
// kept getAssigneeStats below but updated logic
function getAssigneeStats() {
    const stats = {};
    const today = new Date(); today.setHours(0, 0, 0, 0);

    const traverse = (tasks) => {
        tasks.forEach(t => {
            const name = t.assignee ? (t.assignee.name || t.assignee) : 'Unassigned';
            if (!stats[name]) stats[name] = { name, total: 0, planned: 0, done: 0, delayed: 0 };

            stats[name].total++;
            if (t.progress === 100) {
                stats[name].done++;
            } else {
                if (t.end) {
                    const e = new Date(t.end);
                    if (e <= today) stats[name].planned++; // Due/Planned by today (includes overdue)
                    if (e < today) stats[name].delayed++;
                }
            }
            if (t.subtasks) traverse(t.subtasks);
        });
    };
    project.phases.forEach(p => traverse(p.tasks));
    return Object.values(stats);
}

function countTasks(phases) {
    let count = 0;
    phases.forEach(p => { count += p.tasks.length; p.tasks.forEach(t => count += countSubtasks(t)); });
    return count;
}
function countSubtasks(task) {
    let c = 0;
    if (task.subtasks) { c += task.subtasks.length; task.subtasks.forEach(st => c += countSubtasks(st)); }
    return c;
}
function countCompletedTasks(phases) {
    let count = 0;
    phases.forEach(p => { count += p.tasks.filter(t => t.progress === 100).length; p.tasks.forEach(t => count += countCompletedSubtasks(t)); });
    return count;
}
function countCompletedSubtasks(task) {
    let c = 0;
    if (task.subtasks) { c += task.subtasks.filter(t => t.progress === 100).length; task.subtasks.forEach(st => c += countCompletedSubtasks(st)); }
    return c;
}
function countDelayedTasks(phases) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    let count = 0;
    const check = (t) => { if (t.end) { const e = new Date(t.end); if (e < today && t.progress < 100) return 1; } return 0; };
    const traverse = (tasks) => { tasks.forEach(t => { count += check(t); if (t.subtasks) traverse(t.subtasks); }); };
    phases.forEach(p => traverse(p.tasks));
    return count;
}

export function renderMiniDashboard() {
    if (!project) return;
    const container = document.getElementById('mini-dashboard');
    if (!container) return;
    container.innerHTML = '';

    const totalTasks = countTasks(project.phases);
    const completedTasks = countCompletedTasks(project.phases);
    const progress = totalTasks === 0 ? 0 : Math.round((completedTasks / totalTasks) * 100);
    const delayedTasks = countDelayedTasks(project.phases);

    // Style helper
    const cardStyle = 'min-width: 250px; background: var(--bg-color); padding: 1rem; border-radius: 8px; border: 1px solid var(--border-color); display:flex; flex-direction:column; justify-content:flex-start;';

    // 1. Progress Card
    const progCard = document.createElement('div');
    progCard.style.cssText = cardStyle;
    progCard.innerHTML = `
        <h3 style="margin:0 0 1rem 0; font-size:1rem; color:var(--text-primary);">Progress</h3>
        <div style="font-size:2rem; font-weight:bold; color:var(--accent-color); margin-bottom:0.5rem;">${progress}%</div>
        <div class="progress-bar-bg" style="height:8px;"><div class="progress-bar-fill" style="width:${progress}%; height:100%;"></div></div>
        <div style="margin-top:0.5rem; font-size:0.8rem; color:var(--text-secondary);">${completedTasks} / ${totalTasks} Tasks Completed</div>
    `;
    container.appendChild(progCard);

    // 2. Health Card
    const healthCard = document.createElement('div');
    healthCard.style.cssText = cardStyle;
    healthCard.innerHTML = `
        <h3 style="margin:0 0 1rem 0; font-size:1rem; color:var(--text-primary);">Health</h3>
        <div style="display:flex; flex-direction:column; gap:0.5rem;">
             <div class="stat-item"><span>Delayed Tasks:</span> <span style="font-weight:bold; color:${delayedTasks > 0 ? '#ef4444' : 'var(--text-primary)'}">${delayedTasks}</span></div>
             <div class="stat-item"><span>Active Phases:</span> <span>${project.phases.length}</span></div>
             <div class="stat-item"><span>Milestones:</span> <span>${project.milestones.length}</span></div>
        </div>
    `;
    container.appendChild(healthCard);

    // 3. Workload Card (Top 5)
    // Modified: Show delayed tasks count as requested
    const assigneeStats = getAssigneeStats().sort((a, b) => b.total - a.total).slice(0, 5);
    const workloadCard = document.createElement('div');
    workloadCard.style.cssText = cardStyle + ' min-width: 300px;';
    workloadCard.innerHTML = `<h3 style="margin:0 0 0.5rem 0; font-size:1rem; color:var(--text-primary);">Assignee Workload</h3>`;

    const ul = document.createElement('ul');
    ul.style.listStyle = 'none'; ul.style.padding = 0; ul.style.margin = 0; ul.style.flex = '1'; ul.style.overflowY = 'auto';
    assigneeStats.forEach(a => {
        const delayedText = a.delayed > 0 ? `<span style="color:#ef4444; margin-left:4px;">(${a.delayed}⚠)</span>` : '';
        ul.innerHTML += `
            <li style="display:flex; justify-content:space-between; margin-bottom:0.5rem; font-size:0.85rem;">
                <span title="${a.name}" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:120px;">${a.name}</span>
                <span>
                    <span style="color:var(--text-secondary)">${a.done}/</span><strong>${a.total}</strong>
                    ${delayedText}
                </span>
            </li>
        `;
    });
    workloadCard.appendChild(ul);
    container.appendChild(workloadCard);

    // 4. Phase Stats Card (New)
    const phaseStats = getPhaseStats(project.phases);
    const phaseCard = document.createElement('div');
    phaseCard.style.cssText = cardStyle + ' min-width: 300px;';
    phaseCard.innerHTML = `<h3 style="margin:0 0 0.5rem 0; font-size:1rem; color:var(--text-primary);">Phase Health</h3>`;

    const pUl = document.createElement('ul');
    pUl.style.listStyle = 'none'; pUl.style.padding = 0; pUl.style.margin = 0; pUl.style.flex = '1'; pUl.style.overflowY = 'auto';
    phaseStats.forEach(p => {
        const delayedText = p.delayed > 0 ? `<span style="color:#ef4444; margin-left:4px;">(${p.delayed}⚠)</span>` : '';
        pUl.innerHTML += `
            <li style="display:flex; justify-content:space-between; margin-bottom:0.5rem; font-size:0.85rem;">
                <span title="${p.title}" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:150px;">${p.title}</span>
                <span>
                     <span style="color:var(--text-secondary)">Total:</span> <strong>${p.total}</strong>
                     ${delayedText}
                </span>
            </li>
        `;
    });
    phaseCard.appendChild(pUl);
    container.appendChild(phaseCard);
}

export function toggleDashboardView() {
    const dashContainer = document.getElementById('dashboard-container');
    const timelineWrap = document.querySelector('#tab-dashboard .timeline-wrapper');
    const wbsWrap = document.getElementById('wbs-container'); // Wrapper? Check ID.
    // Index.html: wbs-container wraps both table and gantt.
    // main.js used ".timeline-wrapper" and ".wbs-wrapper"?
    // Let's check main.js logic (lines 1873-1893).
    // It used querySelector.
    // index.html: 
    // <div id="dashboard-view" class="timeline-container">...</div> is usage in main.js
    // <div id="wbs-container" class="wbs-container">...</div>

    // In main.js 1875: `const timelineWrap = document.querySelector('.timeline-wrapper');`
    // Use IDs if possible for safety, or classNames matching. 
    // `renderTimeline` sets `timelineView.className = 'timeline-wrapper ...'`.
    // So querySelector('.timeline-wrapper') works if rendered.
    // Safest to use ID `dashboard-view` for timeline.

    const btn = document.getElementById('view-dashboard-btn');

    if (dashContainer.style.display === 'none') {
        dashContainer.style.display = 'block';
        if (timelineWrap) timelineWrap.style.display = 'none';
        if (wbsWrap) wbsWrap.style.display = 'none';
        if (btn) btn.classList.add('active');
        renderDashboard();
    } else {
        dashContainer.style.display = 'none';
        if (timelineWrap) timelineWrap.style.display = 'block';
        if (wbsWrap) wbsWrap.style.display = 'block';
        if (btn) btn.classList.remove('active');
        // Import renderTimeline/renderWBS to re-render?
        // Actually toggling display is enough usually, logic calls render if data changed.
    }
}
