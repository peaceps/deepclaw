import { HookManager } from "../services/hook-manager";
import { isSpawnedLoop, type OneLoopContext } from "../../definitions/definitions";
import { BackgroundCommandManager } from "../services/background-command-manager";

// A spawned loop shares the loopId of the loop that spawned it, so draining there would swallow
// results that loop is waiting for and drop them into a history that is thrown away minutes later.
HookManager.onVisitor('preTurnStart', async (oneLoopContext: OneLoopContext) => {
    if (isSpawnedLoop(oneLoopContext.loopKind)) {
        return;
    }
    const finishedCommands = BackgroundCommandManager.drainFinishedCommands(oneLoopContext.loopId);
    if (finishedCommands.length > 0) {
        oneLoopContext.actions.addStringMessage(`${finishedCommands.length} background commands finished: 
${JSON.stringify(finishedCommands)}`);
    }
});
