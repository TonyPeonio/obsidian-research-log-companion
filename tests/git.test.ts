import { describe, expect, it } from "vitest";
import { browsableRemote, changedFilesSince, gitInfo, parsePorcelain, renderRepoLine, repoPathProblem } from "../src/core/git";
import { cleanRepo, fakeGit } from "./fakes";

describe("gitInfo", () => {
	it("reads branch, commit, dirty files and remote from a repo", () => {
		const git = fakeGit({ ...cleanRepo, "status --porcelain --untracked-files=all": " M configs/base.yaml\n?? results/new.csv\nR  old.py -> new.py\n" });
		const info = gitInfo(git, "/repo");
		expect(info).toEqual({ ok: true, branch: "main", commit: "3f2a9c1", dirtyFiles: ["configs/base.yaml", "results/new.csv", "new.py"], remoteUrl: "git@github.com:TonyPeonio/thesis.git" });
		expect(renderRepoLine(info)).toBe("main @ 3f2a9c1 (dirty: 3 files)");
		expect(renderRepoLine(gitInfo(fakeGit(cleanRepo), "/repo"))).toBe("main @ 3f2a9c1 (clean)");
	});

	it("says so when the folder is not a repository, git is missing, or there are no commits", () => {
		expect(renderRepoLine(gitInfo(null, "/x"))).toBe("git not available");
		expect(renderRepoLine(gitInfo(fakeGit({ "rev-parse --is-inside-work-tree": new Error("fatal: not a git repository") }), "/x"))).toBe("not a git repository (/x)");
		expect(renderRepoLine(gitInfo(fakeGit({ "rev-parse --is-inside-work-tree": new Error("spawn git ENOENT") }), "/x"))).toBe("git not available");
		expect(renderRepoLine(gitInfo(fakeGit({ "rev-parse --is-inside-work-tree": "true", "rev-parse --short HEAD": new Error("fatal: ambiguous argument 'HEAD'") }), "/x"))).toBe("git repository with no commits yet");
	});

	it("tells a web address from a folder before running git", () => {
		const url = "https://github.com/TonyPeonio/obsidian-fellowship-companion";
		expect(repoPathProblem(url)).toMatch(/web address.*folder on this machine.*private repository is fine/);
		expect(repoPathProblem("git@github.com:TonyPeonio/thesis.git")).toMatch(/web address/);
		expect(repoPathProblem("github.com/TonyPeonio/thesis")).toMatch(/web address/);
		expect(repoPathProblem("C:\\Users\\tony\\code\\thesis")).toBeUndefined();
		expect(repoPathProblem("/home/tony/code/thesis")).toBeUndefined();
		expect(repoPathProblem("")).toBeUndefined();
		let ran = false;
		const info = gitInfo(() => ((ran = true), "true"), url);
		expect(ran).toBe(false);
		expect(info).toEqual({ ok: false, reason: "not-a-folder", detail: url });
		expect(renderRepoLine(info)).toBe(`repository folder is a web address (${url}); set the checked-out folder on this machine in settings`);
	});

	it("lists files changed since the previous entry's commit plus uncommitted ones", () => {
		const git = fakeGit({ ...cleanRepo, "status --porcelain --untracked-files=all": " M a.yaml\n", "diff --name-only abc1234..HEAD": "b.json\na.yaml\n" });
		const info = gitInfo(git, "/repo");
		expect(changedFilesSince(git, info, "abc1234").sort()).toEqual(["a.yaml", "b.json"]);
		expect(changedFilesSince(git, info, "3f2a9c1")).toEqual(["a.yaml"]);
		expect(changedFilesSince(git, info, undefined)).toEqual(["a.yaml"]);
	});

	it("parses porcelain quoting and makes remotes browsable", () => {
		expect(parsePorcelain('?? "with space.csv"\n')).toEqual(["with space.csv"]);
		expect(browsableRemote("git@github.com:TonyPeonio/thesis.git")).toBe("https://github.com/TonyPeonio/thesis");
		expect(browsableRemote("https://gitlab.com/a/b.git")).toBe("https://gitlab.com/a/b");
		expect(browsableRemote(undefined)).toBeUndefined();
	});
});
