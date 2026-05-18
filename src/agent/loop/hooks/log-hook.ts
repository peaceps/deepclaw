import { HookManager } from "../services/hook-manager";
import type { OneLoopContext } from "../../definitions/definitions.js";

HookManager.on('preLoopStart', (oneLoopContext: OneLoopContext) => {
    oneLoopContext.logger.info('Starting loop');
});

HookManager.on('preTurnStart', (oneLoopContext: OneLoopContext) => {
    oneLoopContext.logger.info(`Starting turn ${oneLoopContext.turnCount + 1}`);
});