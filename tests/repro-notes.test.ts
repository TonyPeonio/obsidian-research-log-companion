import { describe, expect, it } from "vitest";
import { parseLog } from "../src/core/entry";
import { queriesHeader, upsertSection } from "../src/core/notes";
import { cardFileName, renderReproCard } from "../src/core/repro";

const entry = parseLog(
	[
		"## 2026-11-07 21:14 · result",
		"what: 0.91 accuracy on the held-out split",
		"repo: main @ 3f2a9c1 (dirty: 2 files)",
		"params: lr=3e-4, batch=128 (from configs/base.yaml)",
		"command: python train.py --config configs/base.yaml",
		"data: results/run12.csv 1.2 MB sha256:9f3cab12e4f0",
		"data: results/big.bin 70 MB sha256:00ff00ff00ff (first 64 MB)",
		"figures: ![[Research/figures/loss.png]]",
		"notes: seed 7",
	].join("\n"),
)[0];

describe("reproducibility card", () => {
	it("has every provenance section and warns about a dirty tree", () => {
		const card = renderReproCard({ entry, projectName: "Thesis", logPath: "Research/Thesis log.md", repoPath: "/repo", remoteUrl: "git@github.com:TonyPeonio/thesis.git" });
		expect(card).toContain("type: reproducibility-card");
		expect(card).toContain("Source entry: [[Research/Thesis log#2026-11-07 21:14 · result]]");
		expect(card).toContain("- Commit: `3f2a9c1` on `main` — **working tree had uncommitted changes**");
		expect(card).toContain("- Repository: https://github.com/TonyPeonio/thesis ([commit](https://github.com/TonyPeonio/thesis/commit/3f2a9c1))");
		expect(card).toContain("```sh\npython train.py --config configs/base.yaml\n```");
		expect(card).toContain("| lr | `3e-4` |");
		expect(card).toContain("From `configs/base.yaml`:");
		expect(card).toContain("2 files, 71 MB total.");
		expect(card).toContain("- results/big.bin 70 MB sha256:00ff00ff00ff (first 64 MB)");
		expect(card).toContain("![[Research/figures/loss.png]]");
		expect(card).toContain("## Notes\n\nseed 7");
	});

	it("degrades gracefully without git or params", () => {
		const bare = parseLog("## 2026-11-07 21:14 · result\nwhat: x\nrepo: git not available\n")[0];
		const card = renderReproCard({ entry: bare, projectName: "Thesis", logPath: "Research/Thesis log.md", repoPath: "" });
		expect(card).toContain("- git not available");
		expect(card).toContain("_None recorded._");
		expect(card).toContain("_No data files recorded._");
	});

	it("names the card file without characters Windows rejects", () => {
		const name = cardFileName("Thesis", entry);
		expect(name).toBe("Thesis card 2026-11-07 2114 result.md");
		expect(name).not.toMatch(/[:·]/);
	});
});

describe("queries note sections", () => {
	it("appends a new section and replaces an existing one in place", () => {
		const header = queriesHeader("Thesis");
		const v1 = upsertSection("", "Timeline", "- one\n", header);
		expect(v1.startsWith(header)).toBe(true);
		expect(v1).toContain("## Timeline\n\n- one\n");
		const v2 = upsertSection(v1, "Runs with lr=3e-4", "- two\n", header);
		expect(v2.indexOf("## Timeline")).toBeLessThan(v2.indexOf("## Runs with lr=3e-4"));
		const v3 = upsertSection(v2, "Timeline", "- replaced\n", header);
		expect(v3).toContain("## Timeline\n\n- replaced\n");
		expect(v3).not.toContain("- one");
		expect(v3).toContain("## Runs with lr=3e-4\n\n- two\n");
		expect(v3.match(/^## /gm)).toHaveLength(2);
	});
});
