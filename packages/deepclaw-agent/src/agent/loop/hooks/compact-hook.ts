import { HookManager } from "../services/hook-manager";
import type { OneLoopContext } from "../../definitions/definitions.js";

HookManager.onVisitor('preTurnStart', async (oneLoopContext: OneLoopContext) => {
    await oneLoopContext.actions.compactIfNeeded();
});
