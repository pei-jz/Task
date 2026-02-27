import { renderAggregation } from '../features/aggregation.js';
import { setupSettingsTab } from './settings.js';
import { renderDashboard } from '../features/dashboard.js';
import { renderWBS } from '../wbs/index.js';
import { renderTimeline } from '../wbs/gantt.js';

export function setupTabs() {
    const tabs = document.querySelectorAll('.tab-btn');
    const contents = document.querySelectorAll('.tab-content');

    function switchTab(targetId) {
        // Update Buttons
        tabs.forEach(btn => {
            if (btn.dataset.target === targetId) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        // Update Content
        contents.forEach(content => {
            if (content.id === targetId) {
                content.style.display = 'block';

                // Specific Logic
                if (targetId === 'tab-dashboard') {
                    renderDashboard(); // Requires import. Note: renderDashboard in dashboard.js updates mini-dashboard.
                    // And we need to update the timeline at bottom.
                    // main.js usually calls renderTimeline on change.
                    // But if we switched tabs, we should ensure it's rendered.
                    // We need a way to call renderTimeline() from here.
                }
                else if (targetId === 'tab-schedule') {
                    // Force resize/render
                    // We need to access renderWBS/renderTimeline. 
                }
                else if (targetId === 'tab-aggregation') {
                    renderAggregation();
                }
                else if (targetId === 'tab-settings') {
                    setupSettingsTab();
                }
            } else {
                content.style.display = 'none';
            }
        });

        localStorage.setItem('active_tab', targetId);
    }

    tabs.forEach(btn => {
        btn.onclick = () => {
            switchTab(btn.dataset.target);
        };
    });

    // Restore or Default
    // Force Default to Dashboard (User Request)
    switchTab('tab-dashboard');
    /* 
    const saved = localStorage.getItem('active_tab');
    if (saved && document.getElementById(saved)) {
        switchTab(saved);
    } else {
        switchTab('tab-dashboard'); // Default
    }
    */
}
