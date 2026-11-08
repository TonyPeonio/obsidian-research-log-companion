import { describe, expect, it } from "vitest";
import { appendEntry, entryLink, formatSize, logHeader, newestFirst, nextEntryId, parseDataFile, parseLog, parseParams, parseSize, renderDataFile, renderEntry, renderParams, type Entry } from "../src/core/entry";
import { T0 } from "./fakes";

const sample: Entry = {
	id: "2026-11-07 21:14 · run",
	time: T0,
	type: "run",
	what: "baseline with the cleaned split",
	repo: "main @ 3f2a9c1 (dirty: 3 files)",
	branch: "main",
	commit: "3f2a9c1",
	dirty: true,
	params: { lr: "3e-4", batch: "64", model: "resnet-18" },
	paramsSource: "configs/base.yaml",
	command: "python train.py --config configs/base.yaml",
	data: [
		{ path: "results/run12.csv", size: 1_200_000, hash: "9f3cab12e4f0", truncated: false },
		{ path: "results/big file.bin", size: 70_000_000, hash: "00ff00ff00ff", truncated: true },
	],
	figures: ["Research/figures/loss_run12.png"],
	notes: "loss plateaued at epoch 12\nthen diverged",
};

describe("entry rendering", () => {
	it("renders the documented layout", () => {
		const text = renderEntry(sample);
		expect(text).toBe(
			[
				"## 2026-11-07 21:14 · run",
				"what: baseline with the cleaned split",
				"repo: main @ 3f2a9c1 (dirty: 3 files)",
				"params: lr=3e-4, batch=64, model=resnet-18 (from configs/base.yaml)",
				"command: python train.py --config configs/base.yaml",
				"data: results/run12.csv 1.2 MB sha256:9f3cab12e4f0",
				"data: results/big file.bin 70 MB sha256:00ff00ff00ff (first 64 MB)",
				"figures: ![[Research/figures/loss_run12.png]]",
				"notes: loss plateaued at epoch 12",
				"  then diverged",
				"",
			].join("\n"),
		);
	});

	it("omits empty provenance lines", () => {
		const text = renderEntry({ id: "2026-11-07 21:15 · idea", time: T0 + 60_000, type: "idea", what: "try cosine schedule", params: {}, data: [], figures: [], notes: "" });
		expect(text).toBe("## 2026-11-07 21:15 · idea\nwhat: try cosine schedule\n");
	});

	it("parses back what it rendered", () => {
		const [parsed] = parseLog(logHeader("Thesis") + "\n" + renderEntry(sample));
		expect(parsed).toEqual(sample);
	});

	it("parses several entries, ignores other headings, keeps order and seq", () => {
		const log = [
			"# Thesis log",
			"",
			"## 2026-11-07 21:14 · run",
			"what: a",
			"repo: main @ 3f2a9c1 (clean)",
			"",
			"## 2026-11-07 21:14 · run · 2",
			"what: b",
			"params: lr=1e-3",
			"notes: first line",
			"",
			"  second paragraph",
			"",
			"## Unrelated heading the user typed",
			"what: not an entry",
			"",
			"## 2026-11-08 09:00 · decision",
			"what: ship it",
			"figures: ![[figs/a.png]] ![[figs/b.png|200]]",
		].join("\n");
		const entries = parseLog(log);
		expect(entries.map((e) => e.id)).toEqual(["2026-11-07 21:14 · run", "2026-11-07 21:14 · run · 2", "2026-11-08 09:00 · decision"]);
		expect(entries[0]).toMatchObject({ branch: "main", commit: "3f2a9c1", dirty: false });
		expect(entries[1]).toMatchObject({ seq: 2, params: { lr: "1e-3" }, notes: "first line\n\nsecond paragraph" });
		expect(entries[2].figures).toEqual(["figs/a.png", "figs/b.png"]);
		expect(newestFirst(entries).map((e) => e.id)[0]).toBe("2026-11-08 09:00 · decision");
	});

	it("bumps the sequence when a stamp and type are taken", () => {
		const existing = parseLog("## 2026-11-07 21:14 · run\nwhat: a\n\n## 2026-11-07 21:14 · run · 2\nwhat: b\n");
		expect(nextEntryId(existing, new Date(T0), "run").id).toBe("2026-11-07 21:14 · run · 3");
		expect(nextEntryId(existing, new Date(T0), "result").id).toBe("2026-11-07 21:14 · result");
	});

	it("appends without touching earlier content", () => {
		const first = appendEntry("", "## 2026-11-07 21:14 · run\nwhat: a\n", "Thesis");
		expect(first.startsWith("---\nproject: Thesis\n")).toBe(true);
		const second = appendEntry(first, "## 2026-11-07 21:20 · result\nwhat: b\n", "Thesis");
		expect(second.startsWith(first)).toBe(true);
		expect(parseLog(second)).toHaveLength(2);
	});

	it("builds heading links", () => {
		expect(entryLink("Research/Thesis log.md", "2026-11-07 21:14 · run")).toBe("[[Research/Thesis log#2026-11-07 21:14 · run]]");
		expect(entryLink("Research/Thesis log.md", "x", "alias")).toBe("[[Research/Thesis log#x|alias]]");
	});
});

describe("sizes, hashes and params lines", () => {
	it("formats sizes like a human", () => {
		expect(formatSize(0)).toBe("0 B");
		expect(formatSize(999)).toBe("999 B");
		expect(formatSize(1200)).toBe("1.2 kB");
		expect(formatSize(1_200_000)).toBe("1.2 MB");
		expect(formatSize(70_000_000)).toBe("70 MB");
		expect(formatSize(3_400_000_000)).toBe("3.4 GB");
		expect(parseSize("1.2 MB")).toBe(1_200_000);
	});

	it("round-trips data lines including the truncation marker", () => {
		for (const f of sample.data) expect(parseDataFile(renderDataFile(f))).toEqual(f);
		expect(parseDataFile("garbage")).toBeNull();
	});

	it("round-trips params and tolerates key: value", () => {
		expect(parseParams(renderParams({ lr: "3e-4", "optim.name": "adamw", tags: "[a,b]" }))).toEqual({ lr: "3e-4", "optim.name": "adamw", tags: "[a,b]" });
		expect(parseParams("lr: 0.1, epochs: 10")).toEqual({ lr: "0.1", epochs: "10" });
	});
});
