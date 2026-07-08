import { OneLoopContext } from "../../definitions/definitions";
import { HookManager } from "../services/hook-manager";

HookManager.onVisitor('preTurnStart', async (oneLoopContext: OneLoopContext) => {
    await oneLoopContext.actions.compactIfNeeded(oneLoopContext);
});

HookManager.onVisitor('toolResultCompacted', (oneLoopContext: OneLoopContext) => {
    oneLoopContext.runtime.historyPersistIndex = 0;
});

HookManager.onVisitor('historyCompacted', (oneLoopContext: OneLoopContext) => {
    oneLoopContext.runtime.historyPersistIndex = 0;
});
