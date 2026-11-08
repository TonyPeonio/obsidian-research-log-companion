import type { FileStat, FileSystem } from "../src/core/files";
import type { RunGit } from "../src/core/git";
import type { VaultAccess } from "../src/core/vault";

/** In-memory file system outside the vault: absolute paths with forward slashes. */
export class FakeFs implements FileSystem {
	files = new Map<string, { text: string; mtime: number; size?: number }>();
	hashed: string[] = [];

	add(path: string, text: string, mtime: number, size?: number): this {
		this.files.set(path, { text, mtime, size });
		return this;
	}

	isDirectory(path: string): boolean {
		const prefix = path.replace(/\/+$/, "") + "/";
		return Array.from(this.files.keys()).some((k) => k.startsWith(prefix));
	}

	listFiles(dir: string): FileStat[] {
		const prefix = dir.replace(/\/+$/, "") + "/";
		const out: FileStat[] = [];
		for (const [k, v] of this.files) {
			if (!k.startsWith(prefix)) continue;
			const rel = k.slice(prefix.length);
			if (rel.split("/").some((seg) => seg.startsWith(".") || seg === "node_modules")) continue;
			out.push({ path: k, rel, size: v.size ?? v.text.length, mtime: v.mtime });
		}
		return out;
	}

	async hashFile(path: string, maxBytes: number): Promise<{ hash: string; truncated: boolean }> {
		const f = this.files.get(path);
		if (!f) throw new Error(`no such file ${path}`);
		this.hashed.push(path);
		// Deterministic fake digest: hex of char codes, padded.
		let h = 0;
		for (const ch of f.text) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
		return { hash: h.toString(16).padStart(8, "0").repeat(8), truncated: (f.size ?? f.text.length) > maxBytes };
	}

	readText(path: string, maxBytes: number): string {
		return (this.files.get(path)?.text ?? "").slice(0, maxBytes);
	}

	stat(path: string): FileStat | null {
		const f = this.files.get(path);
		if (!f) return null;
		return { path, rel: path.split("/").pop() ?? path, size: f.size ?? f.text.length, mtime: f.mtime };
	}
}

/** A git runner answering from a table; keys are the joined args. */
export function fakeGit(answers: Record<string, string | Error>): RunGit & { calls: string[][] } {
	const calls: string[][] = [];
	const run = ((args: string[]) => {
		calls.push(args);
		const key = args.join(" ");
		const a = answers[key];
		if (a === undefined) throw new Error(`fatal: unexpected git call: ${key}`);
		if (a instanceof Error) throw a;
		return a;
	}) as RunGit & { calls: string[][] };
	run.calls = calls;
	return run;
}

export const cleanRepo = {
	"rev-parse --is-inside-work-tree": "true\n",
	"rev-parse --short HEAD": "3f2a9c1\n",
	"rev-parse --abbrev-ref HEAD": "main\n",
	"status --porcelain --untracked-files=all": "",
	"remote get-url origin": "git@github.com:TonyPeonio/thesis.git\n",
};

/** In-memory vault. */
export class FakeVault implements VaultAccess {
	files = new Map<string, string>();
	images: { path: string; mtime: number }[] = [];

	constructor(initial: Record<string, string> = {}) {
		for (const [p, c] of Object.entries(initial)) this.files.set(p, c);
	}

	exists(path: string): boolean {
		return this.files.has(path);
	}

	async read(path: string): Promise<string> {
		const c = this.files.get(path);
		if (c === undefined) throw new Error(`Note not found: ${path}`);
		return c;
	}

	async create(path: string, content: string): Promise<void> {
		if (this.files.has(path)) throw new Error(`Already exists: ${path}`);
		this.files.set(path, content);
	}

	async modify(path: string, content: string): Promise<void> {
		if (!this.files.has(path)) throw new Error(`Note not found: ${path}`);
		this.files.set(path, content);
	}

	listNotes(folder: string): string[] {
		return Array.from(this.files.keys()).filter((p) => p.startsWith(folder + "/") && !p.slice(folder.length + 1).includes("/"));
	}

	listImages(folder: string): { path: string; mtime: number }[] {
		return this.images.filter((i) => i.path.startsWith(folder + "/"));
	}
}

export const T0 = new Date(2026, 10, 7, 21, 14).getTime(); // 2026-11-07 21:14 local
