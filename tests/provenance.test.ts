import { describe, expect, it } from "vitest";
import { parseLog, renderEntry } from "../src/core/entry";
import { collectProvenance, pickConfigFile, previousEntryTime } from "../src/core/provenance";
import { FakeFs, T0, cleanRepo, fakeGit } from "./fakes";

const project = { name: "Thesis", logPath: "Research/Thesis log.md", repoPath: "/repo", dataFolders: ["/data/results"], figuresFolder: "Research/figures" };
const HOUR = 3_600_000;

function world() {
	const fs = new FakeFs()
		.add("/repo/configs/base.yaml", "lr: 3e-4\nbatch: 64\n", T0 - HOUR)
		.add("/repo/configs/old.yaml", "lr: 1\n", T0 - 48 * HOUR)
		.add("/repo/train.py", "print(1)", T0 - HOUR)
		.add("/repo/package.json", '{"name":"x"}', T0 - HOUR)
		.add("/data/results/run12.csv", "a,b\n1,2\n", T0 - HOUR, 1_200_000)
		.add("/data/results/run11.csv", "old", T0 - 30 * HOUR)
		.add("/data/results/huge.bin", "zzz", T0 - HOUR, 70 * 1024 * 1024)
		.add("/data/results/.cache/tmp", "x", T0 - HOUR);
	const images = [
		{ path: "Research/figures/loss_run12.png", mtime: T0 - HOUR },
		{ path: "Research/figures/old.png", mtime: T0 - 40 * HOUR },
	];
	return { fs, images };
}

describe("collectProvenance", () => {
	it("fills repo, params, data and figures for a first entry (24 h window)", async () => {
		const { fs, images } = world();
		const git = fakeGit({ ...cleanRepo, "status --porcelain --untracked-files=all": " M configs/base.yaml\n" });
		const { entry, warnings } = await collectProvenance(project, { type: "run", what: "baseline", notes: "n" }, { now: new Date(T0), existing: [], fs, runGit: git, listImages: () => images });
		expect(entry.id).toBe("2026-11-07 21:14 · run");
		expect(entry.repo).toBe("main @ 3f2a9c1 (dirty: 1 file)");
		expect(entry.params).toEqual({ lr: "3e-4", batch: "64" });
		expect(entry.paramsSource).toBe("configs/base.yaml");
		expect(entry.data.map((d) => d.path)).toEqual(["results/huge.bin", "results/run12.csv"]);
		expect(entry.data[0]).toMatchObject({ truncated: true, size: 70 * 1024 * 1024 });
		expect(entry.data[1]).toMatchObject({ truncated: false, size: 1_200_000 });
		expect(entry.data[1].hash).toHaveLength(12);
		expect(entry.figures).toEqual(["Research/figures/loss_run12.png"]);
		expect(warnings).toEqual([]);
		// And it survives the round trip through the note.
		const back = parseLog(renderEntry(entry))[0];
		expect(back).toEqual({ ...entry, data: entry.data.map((d, i) => ({ ...d, size: back.data[i].size })) });
		expect(back.data[0].size).toBe(73_000_000); // 73 MB, human-rounded in the note
	});

	it("only reports what changed since the previous entry", async () => {
		const { fs, images } = world();
		const previous = parseLog(`## 2026-11-07 20:44 · run\nwhat: earlier\nrepo: main @ 3f2a9c1 (clean)\n`); // 30 min before T0
		fs.add("/data/results/run13.csv", "new", T0 - 10 * 60_000);
		images.push({ path: "Research/figures/new.png", mtime: T0 - 60_000 });
		const git = fakeGit(cleanRepo);
		const { entry } = await collectProvenance(project, { type: "result", what: "r", notes: "" }, { now: new Date(T0), existing: previous, fs, runGit: git, listImages: () => images });
		expect(entry.data.map((d) => d.path)).toEqual(["results/run13.csv"]);
		expect(entry.figures).toEqual(["Research/figures/new.png"]);
		expect(entry.params).toEqual({}); // clean tree, same commit, no config newer than 20:44
		expect(git.calls.some((c) => c[0] === "diff")).toBe(false);
	});

	it("uses the diff against the previous entry's commit to find the changed config", async () => {
		const { fs, images } = world();
		fs.add("/repo/jobs/train.sh", "python train.py --lr 1e-3 --epochs 5\n", T0 - 2 * HOUR);
		const previous = parseLog(`## 2026-11-06 10:00 · run\nwhat: earlier\nrepo: main @ abc1234 (clean)\n`);
		const git = fakeGit({ ...cleanRepo, "diff --name-only abc1234..HEAD": "jobs/train.sh\ntrain.py\n" });
		const { entry } = await collectProvenance(project, { type: "run", what: "r", notes: "" }, { now: new Date(T0), existing: previous, fs, runGit: git, listImages: () => images });
		expect(entry.paramsSource).toBe("jobs/train.sh");
		expect(entry.params).toEqual({ lr: "1e-3", epochs: "5" });
		expect(entry.command).toBe("python train.py --lr 1e-3 --epochs 5");
	});

	it("never fails when git is missing or the folders do not exist", async () => {
		const fs = new FakeFs();
		const { entry, warnings } = await collectProvenance({ ...project, dataFolders: ["/nope"] }, { type: "idea", what: "i", notes: "" }, { now: new Date(T0), existing: [], fs, runGit: null, listImages: () => [] });
		expect(entry.repo).toBe("repository folder not found (/repo)");
		expect(warnings).toHaveLength(1);
		expect(entry.data).toEqual([]);
		fs.add("/repo/x.txt", "", T0);
		const r2 = await collectProvenance(project, { type: "idea", what: "i", notes: "" }, { now: new Date(T0), existing: [], fs, runGit: null, listImages: () => [] });
		expect(r2.entry.repo).toBe("git not available");
	});

	it("picks the newest config file and ignores package.json-style files", () => {
		const { fs } = world();
		expect(pickConfigFile(fs, "/repo", [], T0 - 2 * HOUR)?.rel).toBe("configs/base.yaml");
		expect(pickConfigFile(fs, "/repo", ["configs/old.yaml"], T0)?.rel).toBe("configs/old.yaml");
		expect(pickConfigFile(fs, "/repo", [], T0)).toBeNull();
	});

	it("derives the previous entry time", () => {
		expect(previousEntryTime([], new Date(T0))).toBe(T0 - 24 * HOUR);
		expect(previousEntryTime(parseLog("## 2026-11-07 20:00 · run\nwhat: a\n\n## 2026-11-07 19:00 · run\nwhat: b\n"), new Date(T0))).toBe(new Date(2026, 10, 7, 20, 0).getTime());
	});
});
