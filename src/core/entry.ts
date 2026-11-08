// The log entry: an append-only block under a `## <stamp> · <type>` heading made of
// `key: value` lines. Rendering and parsing are inverses so queries can read back what
// the plugin wrote. No Obsidian import.

import { formatStamp, parseStamp } from "./dates";

export const ENTRY_TYPES = ["run", "result", "decision", "idea"] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];

export const ENTRY_TYPE_LABELS: Record<EntryType, string> = {
	run: "Experiment",
	result: "Result",
	decision: "Decision",
	idea: "Idea",
};

export interface DataFile {
	/** Path shown to the user, e.g. `results/run12.csv`. */
	path: string;
	size: number;
	/** Short sha256 prefix (hex). */
	hash: string;
	/** True when only the first HASH_CAP_BYTES were hashed. */
	truncated: boolean;
}

export interface Entry {
	/** Heading text after `## `, e.g. `2026-11-07 21:14 · run`; also the link anchor. */
	id: string;
	/** Epoch ms of the stamp. */
	time: number;
	type: EntryType;
	/** `2` and up when several entries share a stamp and type. */
	seq?: number;
	what: string;
	/** Verbatim repo line, e.g. `main @ 3f2a9c1 (clean)` or `not a git repository`. */
	repo?: string;
	branch?: string;
	commit?: string;
	dirty?: boolean;
	params: Record<string, string>;
	/** Name of the file the params came from. */
	paramsSource?: string;
	command?: string;
	data: DataFile[];
	/** Vault paths of figures. */
	figures: string[];
	notes: string;
}

export const HASH_CAP_BYTES = 64 * 1024 * 1024;
export const HASH_CAP_LABEL = "first 64 MB";

const HEADING_RE = /^## (\d{4}-\d{2}-\d{2} \d{2}:\d{2}) · (run|result|decision|idea)(?: · (\d+))?\s*$/;

export function entryId(stamp: string, type: EntryType, seq?: number): string {
	return `${stamp} · ${type}${seq && seq > 1 ? ` · ${seq}` : ""}`;
}

/** Chooses an id for a new entry at `now`, bumping the sequence when the stamp is taken. */
export function nextEntryId(existing: Entry[], now: Date, type: EntryType): { id: string; seq?: number; stamp: string } {
	const stamp = formatStamp(now);
	const taken = new Set(existing.map((e) => e.id));
	let seq: number | undefined;
	for (;;) {
		const id = entryId(stamp, type, seq);
		if (!taken.has(id)) return { id, seq, stamp };
		seq = (seq ?? 1) + 1;
	}
}

// ---------------------------------------------------------------- rendering

export function formatSize(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes < 0) return "? B";
	if (bytes < 1000) return `${bytes} B`;
	const units = ["kB", "MB", "GB", "TB"];
	let v = bytes;
	let i = -1;
	do {
		v /= 1000;
		i++;
	} while (v >= 1000 && i < units.length - 1);
	return `${v < 10 ? v.toFixed(1) : String(Math.round(v))} ${units[i]}`;
}

export function parseSize(text: string): number {
	const m = /^(\d+(?:\.\d+)?) (B|kB|MB|GB|TB)$/.exec(text.trim());
	if (!m) return NaN;
	const mult = { B: 1, kB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12 }[m[2] as "B" | "kB" | "MB" | "GB" | "TB"];
	return Math.round(Number(m[1]) * mult);
}

export function renderDataFile(f: DataFile): string {
	return `${f.path} ${formatSize(f.size)} sha256:${f.hash}${f.truncated ? ` (${HASH_CAP_LABEL})` : ""}`;
}

export function parseDataFile(text: string): DataFile | null {
	const m = /^(.+?) (\d+(?:\.\d+)?|\?) (B|kB|MB|GB|TB) sha256:([0-9a-f]+)( \(first 64 MB\))?$/.exec(text.trim());
	if (!m) return null;
	return { path: m[1], size: m[2] === "?" ? NaN : parseSize(`${m[2]} ${m[3]}`), hash: m[4], truncated: Boolean(m[5]) };
}

export function renderParams(params: Record<string, string>): string {
	return Object.entries(params)
		.map(([k, v]) => `${k}=${v}`)
		.join(", ");
}

/** Inverse of `renderParams`; tolerant of `key: value` and `;` separators. */
export function parseParams(text: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const part of text.split(/[,;]\s+(?=[A-Za-z_][\w.-]*\s*[=:])/)) {
		const m = /^\s*([A-Za-z_][\w.-]*)\s*[=:]\s*(.*?)\s*$/.exec(part);
		if (m) out[m[1]] = m[2];
	}
	return out;
}

/** Multi-line values continue on lines indented by two spaces. */
function field(key: string, value: string): string {
	const lines = value.replace(/\r\n?/g, "\n").split("\n");
	return `${key}: ${lines.join("\n  ")}`;
}

export function renderEntry(e: Entry): string {
	const lines: string[] = [`## ${e.id}`, field("what", e.what.trim() || "—")];
	if (e.repo) lines.push(`repo: ${e.repo}`);
	if (Object.keys(e.params).length > 0) lines.push(`params: ${renderParams(e.params)}${e.paramsSource ? ` (from ${e.paramsSource})` : ""}`);
	if (e.command) lines.push(field("command", e.command));
	for (const f of e.data) lines.push(`data: ${renderDataFile(f)}`);
	for (const fig of e.figures) lines.push(`figures: ![[${fig}]]`);
	if (e.notes.trim()) lines.push(field("notes", e.notes.trim()));
	return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------- parsing

export function parseRepoLine(repo: string): { branch?: string; commit?: string; dirty?: boolean } {
	const m = /^(\S+) @ ([0-9a-f]{6,40}) \((clean|dirty[^)]*)\)/.exec(repo);
	if (!m) return {};
	return { branch: m[1], commit: m[2], dirty: m[3] !== "clean" };
}

export function emptyEntry(id: string, type: EntryType, time: number): Entry {
	return { id, time, type, what: "", params: {}, data: [], figures: [], notes: "" };
}

/** Reads every entry block in a log note, in document order. Other content is ignored. */
export function parseLog(content: string): Entry[] {
	const lines = content.replace(/\r\n?/g, "\n").split("\n");
	const entries: Entry[] = [];
	let current: Entry | null = null;
	let fields: { key: string; value: string }[] = [];

	const flush = () => {
		if (!current) return;
		for (const { key, value } of fields) applyField(current, key, value);
		entries.push(current);
		current = null;
		fields = [];
	};

	for (const line of lines) {
		const h = HEADING_RE.exec(line);
		if (h) {
			flush();
			const date = parseStamp(h[1]);
			const seq = h[3] ? Number(h[3]) : undefined;
			const type = h[2] as EntryType;
			current = emptyEntry(entryId(h[1], type, seq), type, date?.getTime() ?? 0);
			if (seq) current.seq = seq;
			continue;
		}
		if (/^#{1,6} /.test(line)) {
			// Another heading ends the entry.
			flush();
			continue;
		}
		if (!current) continue;
		const f = /^([a-z][a-z-]*): ?(.*)$/.exec(line);
		if (f) fields.push({ key: f[1], value: f[2] });
		else if (/^ {2}/.test(line) && fields.length > 0) fields[fields.length - 1].value += "\n" + line.slice(2);
		else if (line.trim() === "" && fields.length > 0 && fields[fields.length - 1].key === "notes") fields[fields.length - 1].value += "\n";
	}
	flush();
	for (const e of entries) e.notes = e.notes.trim();
	return entries;
}

function applyField(e: Entry, key: string, value: string): void {
	switch (key) {
		case "what":
			e.what = value === "—" ? "" : value;
			break;
		case "repo":
			e.repo = value;
			Object.assign(e, parseRepoLine(value));
			break;
		case "params": {
			const src = /\s\(from ([^)]+)\)\s*$/.exec(value);
			if (src) {
				e.paramsSource = src[1];
				value = value.slice(0, src.index);
			}
			Object.assign(e.params, parseParams(value));
			break;
		}
		case "command":
			e.command = value;
			break;
		case "data": {
			const f = parseDataFile(value);
			if (f) e.data.push(f);
			break;
		}
		case "figures":
			for (const m of value.matchAll(/!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)) e.figures.push(m[1]);
			break;
		case "notes":
			e.notes = e.notes ? `${e.notes}\n${value}` : value;
			break;
		default:
			// Unknown keys are kept out of the model; they stay in the note untouched.
			break;
	}
}

/** Entries newest first. */
export function newestFirst(entries: Entry[]): Entry[] {
	return [...entries].sort((a, b) => b.time - a.time || (b.seq ?? 1) - (a.seq ?? 1));
}

/** Wiki link to an entry's heading in its log note. */
export function entryLink(logPath: string, id: string, alias?: string): string {
	const note = logPath.replace(/\.md$/, "");
	return `[[${note}#${id}${alias ? `|${alias}` : ""}]]`;
}

/** Appends an entry block to a log note's content, creating the header when the note is new. */
export function appendEntry(content: string, rendered: string, projectName: string): string {
	let base = content;
	if (!base.trim()) base = logHeader(projectName);
	const sep = base.endsWith("\n\n") ? "" : base.endsWith("\n") ? "\n" : "\n\n";
	return base + sep + rendered;
}

export function logHeader(projectName: string): string {
	return `---\nproject: ${projectName}\ntype: research-log\n---\n\n# ${projectName} log\n\nAppend-only. Each \`## <date time> · <type>\` entry is written by Research Log Companion; edit the text if you like, but queries read the \`key: value\` lines.\n`;
}
