/**
 * Everything the core needs from the vault, so entries, queries and reports run without
 * Obsidian (the plugin implements it over `app.vault`; tests use an in-memory fake).
 */

export interface VaultAccess {
	exists(path: string): boolean;
	read(path: string): Promise<string>;
	create(path: string, content: string): Promise<void>;
	modify(path: string, content: string): Promise<void>;
	/** Vault-relative paths of notes in `folder` (not recursive). */
	listNotes(folder: string): string[];
	/** Images (png/jpg/jpeg/gif/svg/webp/pdf) under `folder`, recursive, with mtimes. */
	listImages(folder: string): { path: string; mtime: number }[];
}

/** Creates or overwrites. */
export async function writeNote(vault: VaultAccess, path: string, content: string): Promise<void> {
	if (vault.exists(path)) await vault.modify(path, content);
	else await vault.create(path, content);
}

export async function readNoteOrEmpty(vault: VaultAccess, path: string): Promise<string> {
	return vault.exists(path) ? vault.read(path) : "";
}

export function folderOf(path: string): string {
	const i = path.lastIndexOf("/");
	return i < 0 ? "" : path.slice(0, i);
}

export const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp", "pdf", "bmp"]);
