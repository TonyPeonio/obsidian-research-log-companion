import { describe, expect, it } from "vitest";
import { formatStamp } from "../src/core/dates";
import { parseLog } from "../src/core/entry";
import { checkCitations, normaliseSections, parseCitations, renderReportNote, reportFileName, reportSystemPrompt, reportUntil, reportUserMessage } from "../src/core/report";
import { T0 } from "./fakes";

const LOG_PATH = "Research/Thesis log.md";
const entries = parseLog(["## 2026-11-05 11:00 · run", "what: bigger batch", "params: lr=3e-4, batch=128", "", "## 2026-11-07 21:14 · result", "what: 0.91 acc", "notes: better than baseline"].join("\n"));

describe("report prompt", () => {
	it("names the four sections and the citation form", () => {
		const sys = reportSystemPrompt(LOG_PATH);
		expect(sys).toContain("Summary, Results, Decisions, Open questions");
		expect(sys).toContain("[[Research/Thesis log#<entry id>]]");
		expect(sys).not.toContain(".md#");
	});

	it("puts the entries verbatim, oldest first, within the context budget", () => {
		const since = new Date(T0 - 7 * 86_400_000);
		const { message, truncated } = reportUserMessage({ since, until: new Date(T0), entries: [entries[1], entries[0]] }, 16384);
		expect(truncated).toBe(false);
		expect(message.startsWith(`Period: ${formatStamp(since)} to 2026-11-07 21:14. 2 entries, oldest first.`)).toBe(true);
		expect(message.indexOf("## 2026-11-05 11:00 · run")).toBeLessThan(message.indexOf("## 2026-11-07 21:14 · result"));
		expect(message).toContain("params: lr=3e-4, batch=128");
		const many = Array.from({ length: 40 }, (_, i) => ({ ...entries[0], id: `2026-11-0${1 + (i % 7)} 1${i % 10}:00 · run`, notes: "x".repeat(200) }));
		const small = reportUserMessage({ since, until: new Date(T0), entries: many }, 2048);
		expect(small.truncated).toBe(true);
		expect(small.message).toContain("Older entries omitted");
	});

	it("names the report file by ISO week", () => {
		expect(reportFileName("Thesis", "2026-W45")).toBe("Thesis report 2026-W45.md");
	});
});

describe("citation checking", () => {
	it("parses wiki-link citations", () => {
		expect(parseCitations("a [[Research/Thesis log#2026-11-05 11:00 · run]] b [[Other]] [[x#id|alias]]")).toEqual([
			{ raw: "[[Research/Thesis log#2026-11-05 11:00 · run]]", id: "2026-11-05 11:00 · run" },
			{ raw: "[[x#id|alias]]", id: "id" },
		]);
	});

	it("normalises valid citations, flags uncited bullets and unknown ids", () => {
		const known = new Set(entries.map((e) => e.id));
		const md = ["## Summary", "- Batch went to 128 [[Thesis log#2026-11-05 11:00 · run]]", "- Accuracy 0.91 [[Research/Thesis log#2026-11-07 21:14 · result|result]]", "- Something made up", "- Cites a ghost [[Research/Thesis log#2026-11-01 00:00 · run]]", "## Decisions", "- Nothing this period."].join("\n");
		const out = checkCitations(md, known, LOG_PATH);
		expect(out.uncited).toBe(2);
		expect(out.unknown).toEqual(["2026-11-01 00:00 · run"]);
		const lines = out.markdown.split("\n");
		expect(lines[1]).toBe("- Batch went to 128 [[Research/Thesis log#2026-11-05 11:00 · run]]");
		expect(lines[2]).toBe("- Accuracy 0.91 [[Research/Thesis log#2026-11-07 21:14 · result]]");
		expect(lines[3]).toBe("- Something made up _(no citation)_");
		expect(lines[4]).toContain("(?) _(no citation)_");
		expect(lines[6]).toBe("- Nothing this period.");
	});

	it("adds missing sections and normalises heading levels", () => {
		const out = normaliseSections("### **Summary**\n- a\n\n## Results\n- b");
		expect(out).toContain("## Summary\n- a");
		expect(out).toContain("## Decisions\n\n- Nothing this period.");
		expect(out).toContain("## Open questions\n\n- Nothing this period.");
	});

	it("renders the report note with frontmatter and reads `until` back", () => {
		const since = new Date(T0 - 7 * 86_400_000);
		const note = renderReportNote({ projectName: "Thesis", logPath: LOG_PATH, since, until: new Date(T0), model: "qwen3.5:9b", entryCount: 2, truncated: false, uncited: 1, unknown: [] }, "## Summary\n- x\n");
		expect(note).toContain("week: 2026-W45");
		expect(note).toContain("until: 2026-11-07 21:14");
		expect(note).toContain("> [!warning]");
		expect(note).toContain("1 bullet had no valid citation");
		expect(reportUntil(note)).toBe(T0);
		expect(reportUntil("# no frontmatter")).toBeNull();
	});
});
