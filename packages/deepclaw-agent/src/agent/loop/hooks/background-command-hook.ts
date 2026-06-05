import { HookManager } from "../services/hook-manager";
import type { OneLoopContext } from "../../definitions/definitions";
import { BackgroundCommandManager } from "../services/background-command-manager";

HookManager.onVisitor('preTurnStart', async (oneLoopContext: OneLoopContext) => {
    const finishedCommands = BackgroundCommandManager.drainFinishedCommands();
    if (finishedCommands.length > 0) {
        oneLoopContext.actions.addStringMessage(`${finishedCommands.length} background commands finished: 
${JSON.stringify(finishedCommands)}`);
    }
});
