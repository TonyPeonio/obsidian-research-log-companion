// Minimal stand-in for the `obsidian` module so modules that import types from it can be
// loaded under vitest. Only what the tested code touches is defined.
export class Plugin {}
export class Modal {}
export class SuggestModal {}
export class PluginSettingTab {}
export class Setting {}
export class Notice {}
export class TFile {}
export class TFolder {}
export const Platform = { isDesktopApp: true, isWin: false, isMacOS: false, isLinux: true };
export function normalizePath(p: string): string {
	return p.replace(/\/g, "/").replace(/\/{2,}/g, "/").replace(/^\/+|\/+$/g, "");
}
export async function requestUrl(): Promise<never> {
	throw new Error("requestUrl is not available in tests");
}
