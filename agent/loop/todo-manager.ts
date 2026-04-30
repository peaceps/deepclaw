export type TodoItem = {
    content: string;
    status: 'pending' | 'inProgress' | 'completed';
    activeForm?: string;
}

const MARKERS = {
    pending: '[ ]',
    inProgress: '[>]',
    completed: '[√]',
};

export class TodoManager {
    private items: TodoItem[] = [];
    private roundsSinceUpdate: number = 0;
    private threshold: number;
    private static instance: TodoManager;
    private onUpdate: ((state: string) => void) | null = null;

    static getInstance(threshold: number = 4): TodoManager {
        this.instance = this.instance || new TodoManager(threshold);
        return this.instance;
    }

    setOnUpdate(onUpdate: (state: string) => void): void {
        this.onUpdate = onUpdate;
    }

    private constructor(threshold: number = 4) {
        this.threshold = threshold;
    }

    update(items: TodoItem[]): string {
        if (items.length > 12) {
            throw new Error('Keep the session plan short (max 12 items)');
        }
        let inProgressCount = 0;
        const checked: TodoItem[] = [];
        for (const item of items) {
            if (this.isInProgress(item)) {
                inProgressCount++;
                if (inProgressCount > 1) {
                    throw new Error('Only one item can be in progress');
                }
            }
            checked.push(item);
        }
        this.items = checked;
        this.roundsSinceUpdate = 0;
        const state = this.renderState();
        if (this.onUpdate) {
            this.onUpdate(state);
        }
        return state;
    }

    private renderState(): string {
        if (this.items.length === 0) {
            return '没有待办项。';
        }
        const lines = this.items.map(item => {
            const marker = MARKERS[item.status];
            let line = `${marker} ${item.content}`;
            if (this.isInProgress(item) && item.activeForm) {
                line += ` (${item.activeForm})`;
            }
            return line;
        });
        const completed = this.items.filter(item => item.status === 'completed').length;
        lines.push(`(${completed}/${this.items.length} completed)`);
        const steps = lines.join('\n');
        return `当前进度：\n${steps}\n`;
    }

    noteRoundWithoutUpdate(): string {
        this.roundsSinceUpdate++;
        return this.roundsSinceUpdate >= this.threshold ? '<reminder>Refresh your current plan before continuing.</reminder>' : '';
    }

    reset(onUpdate: (state: string) => void): void {
        this.onUpdate = onUpdate;
        this.items = [];
        this.roundsSinceUpdate = 0;
    }

    private isInProgress(item: TodoItem): boolean {
        return item.status === 'inProgress';
    }
}
