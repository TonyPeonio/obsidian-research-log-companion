// Parameter extraction from config and command files. Deterministic, regex-based, capped.
// No Obsidian import.

export const CONFIG_EXTENSIONS = new Set(["yaml", "yml", "json", "toml", "ini", "sh", "slurm", "cfg", "env"]);
export const MAX_PARAMS = 12;
export const MAX_LINES = 60;
const MAX_VALUE_CHARS = 40;

export function extensionOf(path: string): string {
	const base = path.split(/[\\/]/).pop() ?? path;
	const i = base.lastIndexOf(".");
	return i < 0 ? "" : base.slice(i + 1).toLowerCase();
}

export function isConfigFile(path: string): boolean {
	return CONFIG_EXTENSIONS.has(extensionOf(path));
}

function clean(value: string): string {
	let v = value.trim();
	// Trailing comments in yaml/toml/ini/sh.
	v = v.replace(/\s+[#;].*$/, "");
	v = v.replace(/,$/, "");
	if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
	if (v.length > MAX_VALUE_CHARS) v = v.slice(0, MAX_VALUE_CHARS - 1) + "…";
	return v;
}

function isScalar(value: string): boolean {
	const v = value.trim();
	if (!v) return false;
	if (/^[[{]/.test(v) && !/^\[[^\]]{0,30}\]$/.test(v)) return false;
	if (/^[|>]/.test(v)) return false;
	return true;
}

/** Extracts up to MAX_PARAMS `key=value` pairs from the first MAX_LINES lines of a file. */
export function extractParams(text: string, path: string): Record<string, string> {
	const ext = extensionOf(path);
	const lines = text.replace(/\r\n?/g, "\n").split("\n").slice(0, MAX_LINES);
	const out: Record<string, string> = {};
	const add = (k: string, v: string) => {
		if (Object.keys(out).length >= MAX_PARAMS) return;
		if (!(k in out) && isScalar(v)) out[k] = clean(v);
	};

	if (ext === "json") {
		const parsed = parseJsonParams(lines.join("\n"));
		if (parsed) {
			for (const [k, v] of parsed) add(k, v);
			return out;
		}
	}

	if (ext === "sh" || ext === "slurm") {
		for (const raw of lines) {
			const line = raw.trim();
			if (!line || line.startsWith("#")) continue;
			// Shell assignments: KEY=value, export KEY=value.
			const asg = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(\S.*)$/.exec(line);
			if (asg) {
				add(asg[1], asg[2]);
				continue;
			}
			for (const [k, v] of cliFlags(line)) add(k, v);
		}
		return out;
	}

	let section = "";
	for (const raw of lines) {
		const line = raw.replace(/\t/g, "  ");
		const trimmed = line.trim();
		if (!trimmed || /^[#;]/.test(trimmed) || trimmed === "---") continue;
		const sec = /^\[([^\]]+)\]$/.exec(trimmed);
		if (sec) {
			section = sec[1].trim();
			continue;
		}
		const m = /^-?\s*"?([A-Za-z_][\w.-]*)"?\s*[:=]\s*(.*)$/.exec(trimmed);
		if (!m) continue;
		// Nested yaml keys (indented) are kept flat; top-level keys with empty values are containers.
		if (!m[2].trim()) continue;
		const key = section && (ext === "toml" || ext === "ini" || ext === "cfg") ? `${section}.${m[1]}` : m[1];
		add(key, m[2]);
	}
	return out;
}

function parseJsonParams(text: string): [string, string][] | null {
	try {
		const json = JSON.parse(text) as unknown;
		if (!json || typeof json !== "object" || Array.isArray(json)) return null;
		const out: [string, string][] = [];
		const walk = (obj: Record<string, unknown>, prefix: string) => {
			for (const [k, v] of Object.entries(obj)) {
				const key = prefix ? `${prefix}.${k}` : k;
				if (v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") out.push([key, String(v)]);
				else if (Array.isArray(v)) {
					if (v.every((x) => typeof x !== "object")) out.push([key, `[${v.map(String).join(",")}]`]);
				} else if (typeof v === "object" && !prefix) walk(v as Record<string, unknown>, key);
			}
		};
		walk(json as Record<string, unknown>, "");
		return out;
	} catch {
		// Truncated or invalid JSON: fall through to line scanning.
		return null;
	}
}

/** `--lr 3e-4`, `--lr=3e-4`, `-b 64`; flags without a value become `true`. */
export function cliFlags(line: string): [string, string][] {
	const out: [string, string][] = [];
	const tokens = line.split(/\s+/);
	for (let i = 0; i < tokens.length; i++) {
		const t = tokens[i];
		const eq = /^--?([A-Za-z][\w.-]*)=(.+)$/.exec(t);
		if (eq) {
			out.push([eq[1], eq[2]]);
			continue;
		}
		const flag = /^--?([A-Za-z][\w.-]*)$/.exec(t);
		if (!flag) continue;
		const next = tokens[i + 1];
		if (next !== undefined && !/^--?[A-Za-z]/.test(next) && !/[\\]$/.test(next)) {
			out.push([flag[1], next]);
			i++;
		} else out.push([flag[1], "true"]);
	}
	return out;
}

const COMMAND_RE = /^(?:srun|mpirun|mpiexec|torchrun|accelerate|python3?|julia|Rscript|matlab|make|cargo|go|node|npm|\.\/\S+)\b/;

/** The first line in a script that looks like the command that ran the experiment. */
export function extractCommand(text: string): string | undefined {
	const lines = text.replace(/\r\n?/g, "\n").split("\n");
	for (let i = 0; i < Math.min(lines.length, MAX_LINES); i++) {
		let line = lines[i].trim();
		if (!line || line.startsWith("#")) continue;
		if (!COMMAND_RE.test(line)) continue;
		// Join backslash-continued lines.
		while (line.endsWith("\\") && i + 1 < lines.length) {
			line = line.slice(0, -1).trim() + " " + lines[++i].trim();
		}
		return line.length > 400 ? line.slice(0, 399) + "…" : line;
	}
	return undefined;
}

/** Numbers compare by value (`3e-4` matches `0.0003`), everything else as trimmed strings. */
export function paramValuesEqual(a: string, b: string): boolean {
	const na = Number(a);
	const nb = Number(b);
	if (a.trim() !== "" && b.trim() !== "" && Number.isFinite(na) && Number.isFinite(nb)) return na === nb;
	return a.trim() === b.trim();
}
