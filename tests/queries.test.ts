import { describe, expect, it } from "vitest";
import { compareRuns, findByParam, parseParamQuery, renderCompare, renderFindResults } from "../src/core/compare";
import { isoWeek, weekStart } from "../src/core/dates";
import { parseLog } from "../src/core/entry";
import { groupByWeek, renderCounts, renderTimeline } from "../src/core/timeline";

const LOG = [
	"## 2026-10-28 09:00 · idea",
	"what: try cosine schedule",
	"",
	"## 2026-11-02 10:00 · run",
	"what: baseline",
	"repo: main @ abc1234 (clean)",
	"params: lr=3e-4, batch=64, model=resnet-18",
	"data: results/run11.csv 1.0 MB sha256:aaaaaaaaaaaa",
	"",
	"## 2026-11-05 11:00 · run",
	"what: bigger batch",
	"repo: main @ 3f2a9c1 (dirty: 1 file)",
	"params: lr=0.0003, batch=128, model=resnet-18",
	"data: results/run11.csv 1.0 MB sha256:aaaaaaaaaaaa",
	"data: results/run12.csv 1.2 MB sha256:bbbbbbbbbbbb",
	"figures: ![[figs/loss.png]]",
	"",
	"## 2026-11-05 12:00 · result",
	"what: 0.91 acc",
	"",
	"## 2026-11-07 21:14 · decision",
	"what: keep batch 128",
].join("\n");

const LOG_PATH = "Research/Thesis log.md";

describe("timeline", () => {
	it("groups by ISO week, newest first, with type counts", () => {
		const groups = groupByWeek(parseLog(LOG));
		expect(groups.map((g) => g.week)).toEqual(["2026-W45", "2026-W44"]);
		expect(groups[0].entries.map((e) => e.id)).toEqual(["2026-11-07 21:14 · decision", "2026-11-05 12:00 · result", "2026-11-05 11:00 · run", "2026-11-02 10:00 · run"]);
		expect(renderCounts(groups[0].counts)).toBe("2 runs, 1 result, 1 decision");
		expect(renderCounts(groups[1].counts)).toBe("1 idea");
	});

	it("renders each entry as a link to its heading", () => {
		const text = renderTimeline(parseLog(LOG), LOG_PATH);
		expect(text).toContain("### 2026-W45 (2026-11-02 – 2026-11-08) — 2 runs, 1 result, 1 decision");
		expect(text).toContain("- [[Research/Thesis log#2026-11-05 11:00 · run]] — bigger batch (`3f2a9c1` dirty, 2 files, 1 figure)");
		expect(text.indexOf("2026-W45")).toBeLessThan(text.indexOf("2026-W44"));
		expect(renderTimeline([], LOG_PATH)).toBe("_No entries yet._\n");
	});

	it("computes ISO weeks across a year boundary", () => {
		expect(isoWeek(new Date(2026, 0, 1))).toBe("2026-W01");
		expect(isoWeek(new Date(2027, 0, 1))).toBe("2026-W53");
		expect(isoWeek(new Date(2024, 11, 30))).toBe("2025-W01");
		expect(weekStart(new Date(2026, 10, 7)).getDay()).toBe(1);
	});
});

describe("compare", () => {
	it("diffs commit, params and data between two runs", () => {
		const [, a, b] = parseLog(LOG);
		const rows = compareRuns(a, b);
		const byField = Object.fromEntries(rows.map((r) => [r.field, r]));
		expect(byField["commit"]).toMatchObject({ a: "abc1234", b: "3f2a9c1", same: false });
		expect(byField["param lr"]).toMatchObject({ a: "3e-4", b: "0.0003", same: true });
		expect(byField["param batch"].same).toBe(false);
		expect(byField["param model"].same).toBe(true);
		expect(byField["data results/run11.csv"].same).toBe(true);
		expect(byField["data results/run12.csv"]).toMatchObject({ a: "—", same: false });
		expect(byField["figures"]).toMatchObject({ a: "—", b: "figs/loss.png", same: false });
	});

	it("renders a table with differences marked", () => {
		const [, a, b] = parseLog(LOG);
		const text = renderCompare(a, b, LOG_PATH);
		expect(text).toContain("A: [[Research/Thesis log#2026-11-02 10:00 · run]]");
		expect(text).toContain("| param batch | 64 | 128 | ≠ |");
		expect(text).toContain("| param lr | 3e-4 | 0.0003 |  |");
		expect(text).toMatch(/^\d+ differences in \d+ compared fields\./m);
	});
});

describe("find by parameter", () => {
	it("parses queries", () => {
		expect(parseParamQuery("lr=3e-4 batch: 64, model")).toEqual([
			{ key: "lr", value: "3e-4" },
			{ key: "batch", value: "64" },
			{ key: "model" },
		]);
	});

	it("matches by value (numerically) or by presence, newest first", () => {
		const entries = parseLog(LOG);
		expect(findByParam(entries, "lr=0.0003").map((e) => e.id)).toEqual(["2026-11-05 11:00 · run", "2026-11-02 10:00 · run"]);
		expect(findByParam(entries, "batch=64").map((e) => e.id)).toEqual(["2026-11-02 10:00 · run"]);
		expect(findByParam(entries, "model").length).toBe(2);
		expect(findByParam(entries, "lr=1").length).toBe(0);
		expect(findByParam(entries, "")).toEqual([]);
	});

	it("renders results with links", () => {
		const entries = parseLog(LOG);
		const text = renderFindResults("batch=128", findByParam(entries, "batch=128"), LOG_PATH);
		expect(text).toContain("1 entry match `batch=128`:");
		expect(text).toContain("- [[Research/Thesis log#2026-11-05 11:00 · run]] — bigger batch `3f2a9c1` (lr=0.0003, batch=128, model=resnet-18)");
		expect(renderFindResults("x=1", [], LOG_PATH)).toContain("No entries match");
	});
});
