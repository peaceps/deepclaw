import { TodoManager } from '../loop/services/todo-manager.js';

export type LoopState<I> = {
    messages: I[];
    oneLoopContext: OneLoopContext;
}

export type OneLoopContext = {
    toDoManager: TodoManager;
    toDoUpdated: boolean;
    turnCount: number;
    transitionReason?: 'tool_result' | 'no_tool_use';
}
