// Builds a complete entry from the user's two fields plus provenance collected from git,
// changed config files, watched data folders and the figures folder. Every source is
// injected, so the whole thing runs under vitest with fakes.

import { DAY_MS } from "./dates";
import { HASH_CAP_BYTES, nextEntryId, type DataFile, type Entry, type EntryType } from "./entry";
import { changedDataFiles, joinPath, shortHash, type FileSystem, type FileStat } from "./files";
import { changedFilesSince, gitInfo, renderRepoLine, type GitInfo, type RunGit } from "./git";
import { extractCommand, extractParams, isConfigFile } from "./params";

export interface ProjectLike {
	name: string;
	logPath: string;
	repoPath: string;
	dataFolders: string[];
	figuresFolder: string;
}

export interface ImageInfo {
	/** Vault path. */
	path: string;
	mtime: number;
}

export interface ProvenanceContext {
	now: Date;
	/** Entries already in the log (any order). */
	existing: Entry[];
	fs: FileSystem;
	/** null when git cannot be run (not desktop, or spawning failed). */
	runGit: RunGit | null;
	/** Images in the project's figures folder (vault). */
	listImages: (folder: string) => ImageInfo[];
}

export interface EntryInput {
	type: EntryType;
	what: string;
	notes: string;
}

export interface ProvenanceReport {
	entry: Entry;
	git: GitInfo | null;
	/** Human-readable warnings (nothing fatal). */
	warnings: string[];
	skippedDataFiles: number;
}

/** When no earlier entry exists, "changed since the previous entry" means the last 24 hours. */
export const FIRST_ENTRY_WINDOW_MS = DAY_MS;

export function previousEntryTime(existing: Entry[], now: Date): number {
	const times = existing.map((e) => e.time).filter((t) => t > 0 && t <= now.getTime());
	return times.length ? Math.max(...times) : now.getTime() - FIRST_ENTRY_WINDOW_MS;
}

export function previousCommit(existing: Entry[]): string | undefined {
	const withCommit = existing.filter((e) => e.commit).sort((a, b) => b.time - a.time);
	return withCommit[0]?.commit;
}

export async function collectProvenance(project: ProjectLike, input: EntryInput, ctx: ProvenanceContext): Promise<ProvenanceReport> {
	const warnings: string[] = [];
	const since = previousEntryTime(ctx.existing, ctx.now);
	const { id, seq } = nextEntryId(ctx.existing, ctx.now, input.type);
	const entry: Entry = { id, time: ctx.now.getTime(), type: input.type, what: input.what.trim(), params: {}, data: [], figures: [], notes: input.notes.trim() };
	if (seq) entry.seq = seq;

	// --- git + params
	let git: GitInfo | null = null;
	if (project.repoPath.trim()) {
		const repo = project.repoPath.trim();
		if (!ctx.fs.isDirectory(repo)) {
			entry.repo = `repository folder not found (${repo})`;
			warnings.push(entry.repo);
		} else {
			git = gitInfo(ctx.runGit, repo);
			entry.repo = renderRepoLine(git);
			if (git.ok) Object.assign(entry, { branch: git.branch, commit: git.commit, dirty: git.dirtyFiles.length > 0 });
			const config = pickConfigFile(ctx.fs, repo, git.ok && ctx.runGit ? changedFilesSince(ctx.runGit, git, previousCommit(ctx.existing)) : [], since);
			if (config) {
				const text = ctx.fs.readText(config.path, 64 * 1024);
				entry.params = extractParams(text, config.rel);
				if (Object.keys(entry.params).length > 0) entry.paramsSource = config.rel;
				if (/\.(sh|slurm)$/i.test(config.rel)) entry.command = extractCommand(text);
			}
		}
	}

	// --- data files
	const { files, skipped } = changedDataFiles(ctx.fs, project.dataFolders, since);
	for (const f of files) {
		try {
			const { hash, truncated } = await ctx.fs.hashFile(f.path, HASH_CAP_BYTES);
			entry.data.push({ path: f.shown, size: f.size, hash: shortHash(hash), truncated } satisfies DataFile);
		} catch (err) {
			warnings.push(`Could not hash ${f.shown}: ${(err as Error).message}`);
		}
	}
	if (skipped > 0) warnings.push(`${skipped} more changed data files were not listed (cap is ${files.length}).`);

	// --- figures
	if (project.figuresFolder.trim()) {
		entry.figures = ctx
			.listImages(project.figuresFolder.trim())
			.filter((img) => img.mtime > since)
			.sort((a, b) => a.mtime - b.mtime)
			.map((img) => img.path);
	}

	return { entry, git, warnings, skippedDataFiles: skipped };
}

/**
 * The newest config/command file among those git says changed (repo-relative paths); when git
 * names none, the newest such file in the folder modified after `since`.
 */
export function pickConfigFile(fs: FileSystem, repo: string, gitChanged: string[], since: number): FileStat | null {
	const candidates: FileStat[] = [];
	for (const rel of gitChanged) {
		if (!isConfigFile(rel)) continue;
		const st = fs.stat(joinPath(repo, rel));
		if (st) candidates.push({ ...st, rel });
	}
	if (candidates.length === 0) {
		for (const f of fs.listFiles(repo)) if (isConfigFile(f.rel) && f.mtime > since && !/(^|\/)(package(-lock)?|tsconfig|manifest|versions)\.json$/.test(f.rel)) candidates.push(f);
	}
	candidates.sort((a, b) => b.mtime - a.mtime || a.rel.localeCompare(b.rel));
	return candidates[0] ?? null;
}
