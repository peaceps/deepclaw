import { ToolDesc } from './tool-definitions.js';

import {bashTool} from './bash-tool.js';
import {readFileTool, writeFileTool, editFileTool} from './file-tool.js';

export const concurrencySafeTools: ToolDesc<any>[] = [readFileTool];
export const concurrencyUnsafeTools: ToolDesc<any>[] = [bashTool, writeFileTool, editFileTool];

export const builtInTools: ToolDesc<any>[] = [...concurrencySafeTools, ...concurrencyUnsafeTools];
