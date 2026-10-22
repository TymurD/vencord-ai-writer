import type { IpcMainInvokeEvent } from "electron";

import { RewriteConfig, rewriteSafe } from "./ai";

// Runs in Electron's main process: Discord's CSP blocks fetch to openrouter.ai from the renderer.
export function rewriteMessage(_: IpcMainInvokeEvent, text: string, cfg: RewriteConfig) {
    return rewriteSafe(text, cfg);
}
