import { HookManager } from "../services/hook-manager";
import type { OneLoopContext } from "../../definitions/definitions";
import { BackgroundCommandManager } from "../services/background-command-manager";

// A sub loop shares the loopId of its parent, so draining there would swallow results the
// parent is waiting for and drop them into a history that is thrown away minutes later.
HookManager.onVisitor('preTurnStart', async (oneLoopContext: OneLoopContext) => {
    if (oneLoopContext.isSubLoop) {
        return;
    }
    const finishedCommands = BackgroundCommandManager.drainFinishedCommands(oneLoopContext.loopId);
    if (finishedCommands.length > 0) {
        oneLoopContext.actions.addStringMessage(`${finishedCommands.length} background commands finished: 
${JSON.stringify(finishedCommands)}`);
    }
});
