import { App, TFile, TFolder, normalizePath } from "obsidian";
import { IMAGE_EXTENSIONS, type VaultAccess } from "./core/vault";

/** `VaultAccess` over the live Obsidian vault. */
export class ObsidianVault implements VaultAccess {
	constructor(private app: App) {}

	private file(path: string): TFile | null {
		return this.app.vault.getFileByPath(normalizePath(path));
	}

	exists(path: string): boolean {
		return this.file(path) !== null;
	}

	async read(path: string): Promise<string> {
		const f = this.file(path);
		if (!f) throw new Error(`Note not found: ${path}`);
		return this.app.vault.read(f);
	}

	async create(path: string, content: string): Promise<void> {
		const normalized = normalizePath(path);
		const dir = normalized.includes("/") ? normalized.slice(0, normalized.lastIndexOf("/")) : "";
		if (dir && !this.app.vault.getFolderByPath(dir)) await this.app.vault.createFolder(dir);
		await this.app.vault.create(normalized, content);
	}

	async modify(path: string, content: string): Promise<void> {
		const f = this.file(path);
		if (!f) throw new Error(`Note not found: ${path}`);
		await this.app.vault.modify(f, content);
	}

	listNotes(folder: string): string[] {
		const dir = this.app.vault.getFolderByPath(normalizePath(folder) || "/");
		if (!dir) return [];
		return dir.children.filter((c): c is TFile => c instanceof TFile && c.extension === "md").map((f) => f.path);
	}

	listImages(folder: string): { path: string; mtime: number }[] {
		const dir = this.app.vault.getFolderByPath(normalizePath(folder));
		if (!dir) return [];
		const out: { path: string; mtime: number }[] = [];
		const walk = (f: TFolder) => {
			for (const c of f.children) {
				if (c instanceof TFolder) walk(c);
				else if (c instanceof TFile && IMAGE_EXTENSIONS.has(c.extension.toLowerCase())) out.push({ path: c.path, mtime: c.stat.mtime });
			}
		};
		walk(dir);
		return out;
	}

	/** Every folder path in the vault, for suggestions. */
	listFolders(): string[] {
		const out: string[] = [];
		const walk = (folder: TFolder) => {
			for (const child of folder.children) {
				if (child instanceof TFolder && !child.path.startsWith(this.app.vault.configDir)) {
					out.push(child.path);
					walk(child);
				}
			}
		};
		walk(this.app.vault.getRoot());
		return out.sort((a, b) => a.localeCompare(b));
	}
}
