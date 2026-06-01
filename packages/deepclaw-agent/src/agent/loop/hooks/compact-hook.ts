import { HookManager } from "../services/hook-manager";
import type { OneLoopContext } from "../../definitions/definitions";

HookManager.onVisitor('preTurnStart', async (oneLoopContext: OneLoopContext) => {
    await oneLoopContext.actions.compactIfNeeded();
});
