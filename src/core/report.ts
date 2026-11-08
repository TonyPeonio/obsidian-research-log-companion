// Weekly report: prompt construction for the local model and citation checking of its reply.
// The model only summarises; every bullet must cite an entry id, and we verify that it did.

import { formatDate, formatStamp, isoWeek } from "./dates";
import { entryLink, renderEntry, type Entry } from "./entry";

export const REPORT_SECTIONS = ["Summary", "Results", "Decisions", "Open questions"] as const;

export function reportFileName(projectName: string, week: string): string {
	return `${projectName} report ${week}.md`;
}

export function reportSystemPrompt(logPath: string): string {
	const note = logPath.replace(/\.md$/, "");
	return [
		"You write the weekly research report for a lab notebook. You are given the notebook's entries for the period, verbatim.",
		"Write Markdown with exactly these four `## ` sections in this order: Summary, Results, Decisions, Open questions.",
		"Every section is a list of short bullets. Every bullet ends with a citation of the entry it comes from, in exactly this form:",
		`[[${note}#<entry id>]] where <entry id> is the heading text of that entry, for example [[${note}#2026-11-07 21:14 · run]].`,
		"State only what the entries say. Do not invent results, numbers, or reasons. Keep parameter values and file names exactly as written.",
		"If a section has nothing to report, write a single bullet `- Nothing this period.` without a citation.",
		"Do not add a title, preamble, or closing remarks.",
	].join("\n");
}

export interface ReportInput {
	since: Date;
	until: Date;
	entries: Entry[];
}

/** User message: the period and the entries verbatim, trimmed to fit the context window. */
export function reportUserMessage(input: ReportInput, numCtx: number): { message: string; truncated: boolean } {
	const budgetChars = Math.max(2000, Math.floor((numCtx - 1500) * 3.2));
	const header = `Period: ${formatStamp(input.since)} to ${formatStamp(input.until)}. ${input.entries.length} entries, oldest first.\n\n`;
	const blocks = [...input.entries].sort((a, b) => a.time - b.time).map((e) => renderEntry(e));
	let body = "";
	let truncated = false;
	for (const b of blocks) {
		if (header.length + body.length + b.length > budgetChars) {
			truncated = true;
			break;
		}
		body += b + "\n";
	}
	return { message: header + body.trimEnd() + (truncated ? "\n\n(Older entries omitted to fit the context window.)" : ""), truncated };
}

export interface Citation {
	raw: string;
	id: string;
}

export function parseCitations(markdown: string): Citation[] {
	const out: Citation[] = [];
	for (const m of markdown.matchAll(/\[\[([^\]|]*?)(?:#([^\]|]+))?(?:\|[^\]]*)?\]\]/g)) {
		if (m[2]) out.push({ raw: m[0], id: m[2].trim() });
	}
	return out;
}

export interface CitationCheck {
	markdown: string;
	/** Bullets with no citation to a known entry. */
	uncited: number;
	/** Cited ids that are not in the log. */
	unknown: string[];
}

/**
 * Normalises citations to the full `[[<log>#<id>]]` form, flags bullets without a valid
 * citation, and lists ids the model made up. The "Nothing this period." bullet is exempt.
 */
export function checkCitations(markdown: string, knownIds: Set<string>, logPath: string): CitationCheck {
	const unknown = new Set<string>();
	let uncited = 0;
	const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
	const out = lines.map((line) => {
		if (!/^\s*[-*] /.test(line)) return line;
		if (/Nothing this period\.?\s*$/.test(line)) return line;
		let valid = 0;
		let fixed = line.replace(/\[\[([^\]|]*?)(?:#([^\]|]+))?(?:\|[^\]]*)?\]\]/g, (raw, _note: string, id?: string) => {
			if (!id) return raw;
			const trimmed = id.trim();
			if (knownIds.has(trimmed)) {
				valid++;
				return entryLink(logPath, trimmed);
			}
			unknown.add(trimmed);
			return `${raw} (?)`;
		});
		if (valid === 0) {
			uncited++;
			fixed = `${fixed.trimEnd()} _(no citation)_`;
		}
		return fixed;
	});
	return { markdown: out.join("\n"), uncited, unknown: Array.from(unknown) };
}

/** Makes sure the four sections exist (empty ones get the placeholder bullet). */
export function normaliseSections(markdown: string): string {
	let text = markdown.trim();
	for (const s of REPORT_SECTIONS) {
		const re = new RegExp(`^#{1,4}\\s*\\**${s}\\**\\s*$`, "im");
		if (!re.test(text)) text += `\n\n## ${s}\n\n- Nothing this period.`;
		else text = text.replace(re, `## ${s}`);
	}
	return text + "\n";
}

export interface ReportMeta {
	projectName: string;
	logPath: string;
	since: Date;
	until: Date;
	model: string;
	entryCount: number;
	truncated: boolean;
	uncited: number;
	unknown: string[];
}

export function renderReportNote(meta: ReportMeta, body: string): string {
	const week = isoWeek(meta.until);
	const fm = [
		"---",
		`project: ${meta.projectName}`,
		"type: research-report",
		`week: ${week}`,
		`since: ${formatStamp(meta.since)}`,
		`until: ${formatStamp(meta.until)}`,
		`entries: ${meta.entryCount}`,
		`model: ${meta.model}`,
		"---",
		"",
	];
	const notes: string[] = [];
	if (meta.truncated) notes.push("Older entries were trimmed to fit the model's context window.");
	if (meta.uncited > 0) notes.push(`${meta.uncited} bullet${meta.uncited === 1 ? "" : "s"} had no valid citation and are marked _(no citation)_.`);
	if (meta.unknown.length > 0) notes.push(`${meta.unknown.length} cited id${meta.unknown.length === 1 ? " was" : "s were"} not found in the log and are marked (?).`);
	const header = `# ${meta.projectName} — week ${week}\n\n${meta.entryCount} entries from ${formatDate(meta.since)} to ${formatDate(meta.until)}, summarised by ${meta.model} from [[${meta.logPath.replace(/\.md$/, "")}]]. Check every claim against its citation.\n`;
	const caveat = notes.length ? `\n> [!warning]\n${notes.map((n) => `> ${n}`).join("\n")}\n` : "";
	return fm.join("\n") + header + caveat + "\n" + body;
}

/** `until:` from a report note's frontmatter, as epoch ms, or null. */
export function reportUntil(content: string): number | null {
	const m = /^until:\s*(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\s*$/m.exec(content.slice(0, 600));
	if (!m) return null;
	const [date, time] = m[1].split(" ");
	const [y, mo, d] = date.split("-").map(Number);
	const [h, mi] = time.split(":").map(Number);
	return new Date(y, mo - 1, d, h, mi).getTime();
}
