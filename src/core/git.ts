// Git provenance through an injected runner, so the core never spawns a process itself.
// The plugin passes `execFileSync("git", args, { cwd })`; tests pass a table of answers.

/** Runs `git <args>` in the repository folder and returns stdout; throws when git fails. */
export type RunGit = (args: string[]) => string;

export type GitInfo =
	| {
			ok: true;
			branch: string;
			commit: string;
			/** Paths (repo-relative) with uncommitted changes, including untracked files. */
			dirtyFiles: string[];
			remoteUrl?: string;
	  }
	| { ok: false; reason: "git-unavailable" | "not-a-repo" | "no-commits" | "not-a-folder"; detail?: string };

/**
 * Why a configured repository path cannot work, before git is even run: a web address (the
 * GitHub page of the repository) instead of the folder where it is checked out. Undefined when
 * the path looks like a folder.
 */
export function repoPathProblem(repoPath: string): string | undefined {
	const p = repoPath.trim();
	if (!p) return undefined;
	if (/^(?:https?|ssh|git):\/\//i.test(p) || /^git@[^:]+:/.test(p) || /^(?:www\.)?(?:github|gitlab|bitbucket)\.(?:com|org)\//i.test(p)) {
		return `"${p}" is a web address. Enter the folder on this machine where the repository is checked out (for example C:\\Users\\you\\code\\project or /home/you/code/project); the plugin runs git there and never contacts the remote, so a private repository is fine.`;
	}
	return undefined;
}

export function gitInfo(runGit: RunGit | null, repoPath: string): GitInfo {
	const problem = repoPathProblem(repoPath);
	if (problem) return { ok: false, reason: "not-a-folder", detail: repoPath.trim() };
	if (!runGit) return { ok: false, reason: "git-unavailable" };
	let inside: string;
	try {
		inside = runGit(["rev-parse", "--is-inside-work-tree"]).trim();
	} catch (err) {
		const msg = (err as Error).message ?? "";
		if (/ENOENT|not found|not recognized/i.test(msg)) return { ok: false, reason: "git-unavailable", detail: msg };
		return { ok: false, reason: "not-a-repo", detail: repoPath };
	}
	if (inside !== "true") return { ok: false, reason: "not-a-repo", detail: repoPath };
	let commit: string;
	try {
		commit = runGit(["rev-parse", "--short", "HEAD"]).trim();
	} catch {
		return { ok: false, reason: "no-commits", detail: repoPath };
	}
	let branch = "HEAD";
	try {
		branch = runGit(["rev-parse", "--abbrev-ref", "HEAD"]).trim() || "HEAD";
	} catch {
		// detached or odd state: keep "HEAD"
	}
	const dirtyFiles = parsePorcelain(safe(runGit, ["status", "--porcelain", "--untracked-files=all"]));
	const remote = safe(runGit, ["remote", "get-url", "origin"]).trim();
	return { ok: true, branch, commit, dirtyFiles, remoteUrl: remote || undefined };
}

function safe(runGit: RunGit, args: string[]): string {
	try {
		return runGit(args);
	} catch {
		return "";
	}
}

export function parsePorcelain(text: string): string[] {
	const out: string[] = [];
	for (const raw of text.split(/\r?\n/)) {
		if (raw.length < 4) continue;
		let path = raw.slice(3).trim();
		const arrow = path.indexOf(" -> ");
		if (arrow >= 0) path = path.slice(arrow + 4);
		if (path.startsWith('"') && path.endsWith('"')) path = path.slice(1, -1);
		if (path) out.push(path);
	}
	return out;
}

/** The `repo:` line text. */
export function renderRepoLine(info: GitInfo): string {
	if (!info.ok) {
		switch (info.reason) {
			case "git-unavailable":
				return "git not available";
			case "not-a-repo":
				return `not a git repository${info.detail ? ` (${info.detail})` : ""}`;
			case "not-a-folder":
				return `repository folder is a web address (${info.detail ?? ""}); set the checked-out folder on this machine in settings`;
			case "no-commits":
				return "git repository with no commits yet";
		}
	}
	const n = info.dirtyFiles.length;
	return `${info.branch} @ ${info.commit} (${n === 0 ? "clean" : `dirty: ${n} file${n === 1 ? "" : "s"}`})`;
}

/**
 * Repo-relative paths changed since the previous entry: uncommitted changes plus whatever
 * the commits between `previousCommit` and HEAD touched.
 */
export function changedFilesSince(runGit: RunGit, info: GitInfo, previousCommit: string | undefined): string[] {
	if (!info.ok) return [];
	const set = new Set(info.dirtyFiles);
	if (previousCommit && previousCommit !== info.commit) {
		for (const p of safe(runGit, ["diff", "--name-only", `${previousCommit}..HEAD`]).split(/\r?\n/)) if (p.trim()) set.add(p.trim());
	}
	return Array.from(set);
}

/** Turns `git@github.com:user/repo.git` or an https remote into a browsable URL when it can. */
export function browsableRemote(remote: string | undefined): string | undefined {
	if (!remote) return undefined;
	const ssh = /^(?:ssh:\/\/)?git@([^:/]+)[:/](.+?)(?:\.git)?$/.exec(remote.trim());
	if (ssh) return `https://${ssh[1]}/${ssh[2]}`;
	return remote.trim().replace(/\.git$/, "");
}
