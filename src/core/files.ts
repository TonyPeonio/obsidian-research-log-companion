// What the core needs from the file system outside the vault (data folders, repo files).
// The plugin implements it with Node (`src/node-fs.ts`); tests use an in-memory fake.

export interface FileStat {
	/** Absolute path. */
	path: string;
	/** Path relative to the folder that was listed, with forward slashes. */
	rel: string;
	size: number;
	mtime: number;
}

export interface FileSystem {
	isDirectory(path: string): boolean;
	/** Every regular file under `dir`, recursively, skipping dot-folders and `node_modules`. */
	listFiles(dir: string): FileStat[];
	/** Hashes up to `maxBytes` of the file; `truncated` says whether the file was longer. */
	hashFile(path: string, maxBytes: number): Promise<{ hash: string; truncated: boolean }>;
	/** First `maxBytes` of a text file, "" when unreadable. */
	readText(path: string, maxBytes: number): string;
	stat(path: string): FileStat | null;
}

export const SHORT_HASH_CHARS = 12;
export const MAX_DATA_FILES = 25;

export function shortHash(hex: string): string {
	return hex.slice(0, SHORT_HASH_CHARS);
}

export function joinPath(dir: string, rel: string): string {
	const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
	return dir.replace(/[\\/]+$/, "") + sep + (sep === "\\" ? rel.replace(/\//g, "\\") : rel);
}

export function baseName(path: string): string {
	const parts = path.replace(/[\\/]+$/, "").split(/[\\/]/);
	return parts[parts.length - 1] || path;
}

/** Files in the watched folders modified after `since` (epoch ms), newest first, capped. */
export function changedDataFiles(fs: FileSystem, folders: string[], since: number): { files: (FileStat & { shown: string })[]; skipped: number } {
	const all: (FileStat & { shown: string })[] = [];
	for (const folder of folders) {
		if (!folder.trim() || !fs.isDirectory(folder)) continue;
		const prefix = baseName(folder);
		for (const f of fs.listFiles(folder)) {
			if (f.mtime > since) all.push({ ...f, shown: `${prefix}/${f.rel}` });
		}
	}
	all.sort((a, b) => b.mtime - a.mtime || a.shown.localeCompare(b.shown));
	const files = all.slice(0, MAX_DATA_FILES);
	return { files, skipped: all.length - files.length };
}
