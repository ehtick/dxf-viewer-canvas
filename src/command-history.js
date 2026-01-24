export class CommandHistory {
    constructor(updateUICallback) {
        this.undoStack = [];
        this.redoStack = [];
        this.updateUICallback = updateUICallback;
    }

    execute(command) {
        command.execute();
        this.undoStack.push(command);
        this.redoStack = []; // Clear redo stack on new action
        this.notifyUI();
    }

    undo() {
        if (this.undoStack.length === 0) return;
        const command = this.undoStack.pop();
        command.undo();
        this.redoStack.push(command);
        this.notifyUI();
    }

    redo() {
        if (this.redoStack.length === 0) return;
        const command = this.redoStack.pop();
        command.execute(); // Re-execute
        this.undoStack.push(command);
        this.notifyUI();
    }

    notifyUI() {
        if (this.updateUICallback) {
            this.updateUICallback(this.canUndo(), this.canRedo());
        }
    }

    canUndo() {
        return this.undoStack.length > 0;
    }

    canRedo() {
        return this.redoStack.length > 0;
    }
}
