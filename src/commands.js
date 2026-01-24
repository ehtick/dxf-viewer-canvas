export class CmdAddMeasurement {
    constructor(manager, data) {
        this.manager = manager;
        this.data = data;
    }
    execute() {
        this.manager.restoreMeasurement(this.data);
    }
    undo() {
        this.manager.removeMeasurement(this.data.visual);
    }
}

export class CmdDelete {
    constructor(viewer, measurementManager, selection, onComplete) {
        this.viewer = viewer;
        this.mgr = measurementManager;
        this.selection = [...selection]; // Copy selection array
        this.hiddenEntities = [];
        this.removedMeasurements = [];
        this.onComplete = onComplete; // Callback to clear Global Selection
    }

    execute() {
        this.hiddenEntities = [];
        this.removedMeasurements = [];

        this.selection.forEach(obj => {
            // Un-highlight first to ensure clean state on Undo
            if (this.viewer) this.viewer.highlightObject(obj, false);

            // Check if Measurement
            const removed = this.mgr.removeMeasurement(obj);
            if (removed) {
                this.removedMeasurements.push(removed);
            } else {
                // Assume DXF Entity
                obj.visible = false;
                this.hiddenEntities.push(obj);
            }
        });

        if (this.onComplete) this.onComplete();
    }

    undo() {
        // Restore Entities
        this.hiddenEntities.forEach(obj => {
            obj.visible = true;
        });

        // Restore Measurements
        this.removedMeasurements.forEach(data => {
            this.mgr.restoreMeasurement(data);
        });
    }
}
