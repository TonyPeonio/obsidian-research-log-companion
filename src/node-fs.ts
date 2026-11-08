// Node implementations of the core's injected pieces: the file system outside the vault
// (listing, hashing with a size cap) and the git runner. Desktop only; no Obsidian import,
// so vitest exercises the hashing on real temp files.

import { execFileSync } from "child_process";
import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";
import type { FileStat, FileSystem } from "./core/files";
import type { RunGit } from "./core/git";

const SKIP_DIRS = new Set(["node_modules", "__pycache__", ".git", ".venv", "venv", ".ipynb_checkpoints", ".mypy_cache", ".pytest_cache"]);
const MAX_LISTED = 20_000;

export const nodeFileSystem: FileSystem = {
	isDirectory(p: string): boolean {
		try {
			return fs.statSync(p).isDirectory();
		} catch {
			return false;
		}
	},

	listFiles(dir: string): FileStat[] {
		const out: FileStat[] = [];
		const root = path.resolve(dir);
		const walk = (abs: string, rel: string) => {
			let entries: fs.Dirent[];
			try {
				entries = fs.readdirSync(abs, { withFileTypes: true });
			} catch {
				return;
			}
			for (const d of entries) {
				if (out.length >= MAX_LISTED) return;
				const name = d.name;
				const childAbs = path.join(abs, name);
				const childRel = rel ? `${rel}/${name}` : name;
				if (d.isDirectory()) {
					if (name.startsWith(".") || SKIP_DIRS.has(name)) continue;
					walk(childAbs, childRel);
				} else if (d.isFile()) {
					try {
						const st = fs.statSync(childAbs);
						out.push({ path: childAbs, rel: childRel, size: st.size, mtime: st.mtimeMs });
					} catch {
						// vanished between readdir and stat
					}
				}
			}
		};
		walk(root, "");
		return out;
	},

	async hashFile(p: string, maxBytes: number): Promise<{ hash: string; truncated: boolean }> {
		const st = await fs.promises.stat(p);
		const hash = createHash("sha256");
		const handle = await fs.promises.open(p, "r");
		try {
			const chunk = Buffer.alloc(1024 * 1024);
			let remaining = Math.min(st.size, maxBytes);
			while (remaining > 0) {
				const { bytesRead } = await handle.read(chunk, 0, Math.min(chunk.length, remaining), null);
				if (bytesRead <= 0) break;
				hash.update(chunk.subarray(0, bytesRead));
				remaining -= bytesRead;
			}
		} finally {
			await handle.close();
		}
		return { hash: hash.digest("hex"), truncated: st.size > maxBytes };
	},

	readText(p: string, maxBytes: number): string {
		try {
			const fd = fs.openSync(p, "r");
			try {
				const buf = Buffer.alloc(maxBytes);
				const n = fs.readSync(fd, buf, 0, maxBytes, 0);
				return buf.subarray(0, n).toString("utf8");
			} finally {
				fs.closeSync(fd);
			}
		} catch {
			return "";
		}
	},

	stat(p: string): FileStat | null {
		try {
			const st = fs.statSync(p);
			if (!st.isFile()) return null;
			return { path: p, rel: path.basename(p), size: st.size, mtime: st.mtimeMs };
		} catch {
			return null;
		}
	},
};

/** `git <args>` in `cwd`; throws with git's stderr when it fails. Null when git is missing. */
export function makeRunGit(cwd: string): RunGit {
	return (args: string[]) =>
		execFileSync("git", args, {
			cwd,
			encoding: "utf8",
			timeout: 10_000,
			windowsHide: true,
			stdio: ["ignore", "pipe", "pipe"],
			maxBuffer: 8 * 1024 * 1024,
		});
}

/** True when `git --version` works on this machine. */
export function gitAvailable(): boolean {
	try {
		execFileSync("git", ["--version"], { encoding: "utf8", timeout: 5000, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
		return true;
	} catch {
		return false;
	}
}
