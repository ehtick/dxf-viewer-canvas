
import * as THREE from 'three';

export class TabManager {
    constructor(viewer, app) {
        this.viewer = viewer;
        this.app = app;
        this.tabs = [];
        this.activeTabId = null;
        this.tabCounter = 0;

        this.tabBar = document.getElementById('tab-bar');
        this.viewportOverlay = document.getElementById('viewport-overlay'); // To show/hide help text
    }

    init() {
        // Create initial empty tab
        this.createNewTab("New File");
    }

    createNewTab(name = "New File", dxfData = null, file = null) {
        const id = `tab-${Date.now()}-${this.tabCounter++}`;

        // Create Scene Group for this tab
        const group = new THREE.Group();
        group.name = `RootGroup-${id}`;

        // Initial State
        const tabState = {
            id: id,
            name: name,
            dxfGroup: group, // The scene content
            file: file, // Original file object if saved
            cameraState: {
                position: new THREE.Vector3(0, 0, 50),
                zoom: 1,
                target: new THREE.Vector3(0, 0, 0)
            },
            history: [], // Command history for undo/redo (could be more complex)
            historyIndex: -1,
            isModified: false
        };

        this.tabs.push(tabState);
        this.renderTabBar();
        this.switchToTab(id);

        // If dxfData is provided (from file load), populate it
        if (dxfData) {
            // This suggests we loaded a file *into* this new tab
            // Caller handles populating the group
        }

        return tabState;
    }

    closeTab(id) {
        // Find index
        const index = this.tabs.findIndex(t => t.id === id);
        if (index === -1) return;

        // If closing active tab, switch to another
        if (this.activeTabId === id) {
            if (this.tabs.length > 1) {
                // Switch to previous or next
                const newIndex = index > 0 ? index - 1 : index + 1;
                // Since we are about to remove 'index', check bounds
                if (newIndex < this.tabs.length) {
                    this.switchToTab(this.tabs[newIndex].id);
                }
            } else {
                // Closing last tab -> Create a new empty one?
                // Or just clear it.
                // Let's create a new empty one to ensure app is never empty.
                this.createNewTab();
                // Then continue to close current
            }
        }

        // Dispose resources for this tab (meshes, materials)
        const tab = this.tabs[index];
        this.disposeGroup(tab.dxfGroup);

        this.tabs.splice(index, 1);
        this.renderTabBar();
    }

    switchToTab(id) {
        if (this.activeTabId === id) return;

        // Save current tab state (Camera, etc.)
        const currentTab = this.getActiveTab();
        if (currentTab) {
            currentTab.cameraState.position.copy(this.viewer.camera.position);
            currentTab.cameraState.zoom = this.viewer.camera.zoom;
            // Target? Controls target?
            if (this.viewer.controls) {
                currentTab.cameraState.target.copy(this.viewer.controls.target);
            }
        }

        // Set New Active ID
        this.activeTabId = id;
        const newTab = this.getActiveTab();

        if (!newTab) return;

        // 1. Clear Viewer Scene (remove old group)
        if (this.viewer.dxfGroup) {
            this.viewer.scene.remove(this.viewer.dxfGroup);
        }

        // 2. Set new group
        this.viewer.dxfGroup = newTab.dxfGroup;
        this.viewer.scene.add(this.viewer.dxfGroup);

        // 3. Restore Camera
        this.viewer.camera.position.copy(newTab.cameraState.position);
        this.viewer.camera.zoom = newTab.cameraState.zoom;
        if (this.viewer.controls) {
            this.viewer.controls.target.copy(newTab.cameraState.target);
            this.viewer.controls.update();
        }

        // Update projection matrix
        this.viewer.camera.updateProjectionMatrix();

        // 4. Update UI
        this.renderTabBar();

        // Clear Selection on tab switch
        if (this.app.clearSelection) {
            this.app.clearSelection();
        }

        // Trigger status update
        if (this.app.updateStatus) {
            this.app.updateStatus(`Switched to ${newTab.name}`);
        }

        // Handle "Help Overlay" visibility (only show on empty new tab?)
        // Check if tab has content
        const hasContent = newTab.dxfGroup.children.length > 0;
        if (this.viewportOverlay) {
            // Maybe we always hide it if any file is open, or show if empty?
            // For now, let's keep it simple.
            if (hasContent) {
                this.viewportOverlay.classList.add('hidden');
            } else {
                this.viewportOverlay.classList.remove('hidden');
            }
        }
    }

    getActiveTab() {
        return this.tabs.find(t => t.id === this.activeTabId);
    }

    updateTabName(id, name) {
        const tab = this.tabs.find(t => t.id === id);
        if (tab) {
            tab.name = name;
            this.renderTabBar();
        }
    }

    renderTabBar() {
        if (!this.tabBar) return;
        this.tabBar.innerHTML = '';

        this.tabs.forEach(tab => {
            const el = document.createElement('div');
            el.className = `tab-item ${tab.id === this.activeTabId ? 'active' : ''}`;

            const title = document.createElement('span');
            title.className = 'tab-title';
            title.textContent = tab.name;
            title.onclick = () => this.switchToTab(tab.id);

            const close = document.createElement('button');
            close.className = 'tab-close';
            close.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
            close.onclick = (e) => {
                e.stopPropagation();
                this.closeTab(tab.id);
            };

            el.appendChild(title);
            el.appendChild(close);
            this.tabBar.appendChild(el);
        });

        // Add "New Tab" button at end?
        /*
        const newBtn = document.createElement('button');
        newBtn.className = 'tab-new-btn';
        newBtn.innerHTML = '+';
        newBtn.onclick = () => this.createNewTab();
        this.tabBar.appendChild(newBtn);
        */
    }

    disposeGroup(group) {
        // Recursive dispose
        group.traverse(child => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach(m => m.dispose());
                } else {
                    child.material.dispose();
                }
            }
        });
    }
}
