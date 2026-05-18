import { HookManager } from "../services/hook-manager";
import type { OneLoopContext } from "../../definitions/definitions.js";

HookManager.onVisitor('preLoopStart', (oneLoopContext: OneLoopContext) => {
    oneLoopContext.logger.info('Starting loop');
});

HookManager.onVisitor('preTurnStart', (oneLoopContext: OneLoopContext) => {
    oneLoopContext.logger.info(`Starting turn ${oneLoopContext.turnCount + 1}`);
});