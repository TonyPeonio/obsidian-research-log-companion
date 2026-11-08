// Project timeline: entries grouped by ISO week, newest first, with type counts.

import { formatDate, isoWeek, weekStart } from "./dates";
import { ENTRY_TYPES, entryLink, newestFirst, type Entry, type EntryType } from "./entry";

export interface WeekGroup {
	week: string;
	/** Monday of the week, local midnight (epoch ms). */
	start: number;
	entries: Entry[];
	counts: Record<EntryType, number>;
}

export function groupByWeek(entries: Entry[]): WeekGroup[] {
	const groups = new Map<string, WeekGroup>();
	for (const e of newestFirst(entries)) {
		const d = new Date(e.time);
		const week = isoWeek(d);
		let g = groups.get(week);
		if (!g) {
			g = { week, start: weekStart(d).getTime(), entries: [], counts: { run: 0, result: 0, decision: 0, idea: 0 } };
			groups.set(week, g);
		}
		g.entries.push(e);
		g.counts[e.type]++;
	}
	return Array.from(groups.values()).sort((a, b) => b.start - a.start);
}

export function renderCounts(counts: Record<EntryType, number>): string {
	return ENTRY_TYPES.filter((t) => counts[t] > 0)
		.map((t) => `${counts[t]} ${t}${counts[t] === 1 ? "" : "s"}`)
		.join(", ");
}

/** Body (no `##` title) of the timeline section. */
export function renderTimeline(entries: Entry[], logPath: string): string {
	if (entries.length === 0) return "_No entries yet._\n";
	const out: string[] = [];
	for (const g of groupByWeek(entries)) {
		const end = new Date(g.start + 6 * 86_400_000);
		out.push(`### ${g.week} (${formatDate(new Date(g.start))} – ${formatDate(end)}) — ${renderCounts(g.counts)}`);
		out.push("");
		for (const e of g.entries) {
			const what = e.what ? ` — ${oneLine(e.what)}` : "";
			const extras: string[] = [];
			if (e.commit) extras.push(`\`${e.commit}\`${e.dirty ? " dirty" : ""}`);
			if (e.data.length) extras.push(`${e.data.length} file${e.data.length === 1 ? "" : "s"}`);
			if (e.figures.length) extras.push(`${e.figures.length} figure${e.figures.length === 1 ? "" : "s"}`);
			out.push(`- ${entryLink(logPath, e.id)}${what}${extras.length ? ` (${extras.join(", ")})` : ""}`);
		}
		out.push("");
	}
	return out.join("\n");
}

export function oneLine(text: string, max = 120): string {
	const s = text.replace(/\s+/g, " ").trim();
	return s.length > max ? s.slice(0, max - 1) + "…" : s;
}
