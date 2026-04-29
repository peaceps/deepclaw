import { ToolDesc } from './tool-definitions.js';

import {shellTool} from './shell-tool.js';
import {todoTool} from './todo-tool.js';
import {readFileTool, writeFileTool, editFileTool} from './file-tool.js';

export const concurrencySafeTools: ToolDesc<any>[] = [readFileTool, todoTool];
export const concurrencyUnsafeTools: ToolDesc<any>[] = [shellTool, writeFileTool, editFileTool];

export const builtInTools: ToolDesc<any>[] = [...concurrencySafeTools, ...concurrencyUnsafeTools];
