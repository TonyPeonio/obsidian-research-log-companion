// Deterministic queries over parsed entries: compare two runs, find runs by parameter.

import { entryLink, renderDataFile, type Entry } from "./entry";
import { paramValuesEqual } from "./params";
import { oneLine } from "./timeline";

export interface CompareRow {
	field: string;
	a: string;
	b: string;
	same: boolean;
}

export function compareRuns(a: Entry, b: Entry): CompareRow[] {
	const rows: CompareRow[] = [];
	const push = (field: string, va: string, vb: string, same = va === vb) => rows.push({ field, a: va, b: vb, same });
	push("what", a.what, b.what);
	push("commit", a.commit ?? "—", b.commit ?? "—");
	push("branch", a.branch ?? "—", b.branch ?? "—");
	push("working tree", a.repo ? (a.dirty ? "dirty" : "clean") : "—", b.repo ? (b.dirty ? "dirty" : "clean") : "—");
	if (a.command || b.command) push("command", a.command ?? "—", b.command ?? "—");
	const keys = Array.from(new Set([...Object.keys(a.params), ...Object.keys(b.params)])).sort();
	for (const k of keys) {
		const va = a.params[k];
		const vb = b.params[k];
		push(`param ${k}`, va ?? "—", vb ?? "—", va !== undefined && vb !== undefined && paramValuesEqual(va, vb));
	}
	const paths = Array.from(new Set([...a.data.map((d) => d.path), ...b.data.map((d) => d.path)])).sort();
	for (const p of paths) {
		const da = a.data.find((d) => d.path === p);
		const db = b.data.find((d) => d.path === p);
		push(`data ${p}`, da ? `sha256:${da.hash}` : "—", db ? `sha256:${db.hash}` : "—", Boolean(da && db && da.hash === db.hash));
	}
	if (a.figures.length || b.figures.length) push("figures", a.figures.join(", ") || "—", b.figures.join(", ") || "—");
	return rows;
}

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ") || "—";

/** Body of the compare section: a table, differences marked. */
export function renderCompare(a: Entry, b: Entry, logPath: string): string {
	const rows = compareRuns(a, b);
	const diff = rows.filter((r) => !r.same).length;
	const out: string[] = [];
	out.push(`A: ${entryLink(logPath, a.id)}  `);
	out.push(`B: ${entryLink(logPath, b.id)}`);
	out.push("");
	out.push(`${diff === 0 ? "No differences" : `${diff} difference${diff === 1 ? "" : "s"}`} in ${rows.length} compared fields.`);
	out.push("");
	out.push("| Field | A | B | |");
	out.push("|---|---|---|---|");
	for (const r of rows) out.push(`| ${cell(r.field)} | ${cell(r.a)} | ${cell(r.b)} | ${r.same ? "" : "≠"} |`);
	out.push("");
	for (const e of [a, b]) {
		if (e.data.length) {
			out.push(`${e === a ? "A" : "B"} data:`);
			for (const d of e.data) out.push(`- ${renderDataFile(d)}`);
			out.push("");
		}
	}
	return out.join("\n");
}

export interface ParamQuery {
	key: string;
	/** undefined means "has this parameter at all". */
	value?: string;
}

/** `lr=3e-4 batch=64`, `lr: 3e-4`, or a bare `lr`. */
export function parseParamQuery(text: string): ParamQuery[] {
	const out: ParamQuery[] = [];
	const normalised = text.trim().replace(/\s*[=:]\s*/g, "=");
	for (const part of normalised.split(/[,\s]+/)) {
		if (!part) continue;
		const m = /^([A-Za-z_][\w.-]*)(?:[=:](.*))?$/.exec(part);
		if (!m) continue;
		out.push(m[2] === undefined ? { key: m[1] } : { key: m[1], value: m[2] });
	}
	return out;
}

export function matchesQuery(e: Entry, query: ParamQuery[]): boolean {
	if (query.length === 0) return false;
	return query.every((q) => {
		const key = Object.keys(e.params).find((k) => k === q.key || k.toLowerCase() === q.key.toLowerCase() || k.endsWith(`.${q.key}`));
		if (key === undefined) return false;
		return q.value === undefined || paramValuesEqual(e.params[key], q.value);
	});
}

export function findByParam(entries: Entry[], queryText: string): Entry[] {
	const query = parseParamQuery(queryText);
	return entries.filter((e) => matchesQuery(e, query)).sort((a, b) => b.time - a.time);
}

export function renderFindResults(queryText: string, matches: Entry[], logPath: string): string {
	if (matches.length === 0) return `_No entries match \`${queryText.trim()}\`._\n`;
	const out = [`${matches.length} entr${matches.length === 1 ? "y" : "ies"} match \`${queryText.trim()}\`:`, ""];
	for (const e of matches) {
		const params = Object.entries(e.params)
			.map(([k, v]) => `${k}=${v}`)
			.join(", ");
		out.push(`- ${entryLink(logPath, e.id)}${e.what ? ` — ${oneLine(e.what, 80)}` : ""}${e.commit ? ` \`${e.commit}\`` : ""}${params ? ` (${params})` : ""}`);
	}
	out.push("");
	return out.join("\n");
}
