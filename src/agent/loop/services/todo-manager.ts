import i18n from 'i18next';

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
    private threshold: number = 5;
    private maxItems: number = 12;
    private reminder: (text: string) => void;

    constructor(reminder: (text: string) => void) {
        this.reminder = reminder;
    }

    update(items: TodoItem[]): string {
        if (this.items.length === 0) {
            return i18n.t('agent.tools.todo.empty');
        }
        this.roundsSinceUpdate = -1;
        if (items.length > this.maxItems) {
            throw new Error(`Keep the session plan short (max ${this.maxItems} items)`);
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
        return this.renderState();
    }

    private renderState(): string {
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
        return i18n.t('agent.tools.todo.current', {steps});
    }

    onTurnFinished(): void {
        if (this.items.length > 0) {
            this.roundsSinceUpdate++;
            if (this.roundsSinceUpdate >= this.threshold) {
                this.reminder('<reminder>Refresh your current plan before continuing.</reminder>')
            }
        }
    }

    private isInProgress(item: TodoItem): boolean {
        return item.status === 'inProgress';
    }
}
