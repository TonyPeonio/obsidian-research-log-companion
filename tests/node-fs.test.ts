import { createHash } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { shortHash } from "../src/core/files";
import { nodeFileSystem } from "../src/node-fs";

let dir: string;

beforeAll(() => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), "rlc-test-"));
	fs.mkdirSync(path.join(dir, "sub", ".hidden"), { recursive: true });
	fs.mkdirSync(path.join(dir, "node_modules", "x"), { recursive: true });
	fs.writeFileSync(path.join(dir, "a.csv"), "a,b\n1,2\n");
	fs.writeFileSync(path.join(dir, "sub", "b.json"), '{"lr": 0.1}');
	fs.writeFileSync(path.join(dir, "sub", ".hidden", "c"), "x");
	fs.writeFileSync(path.join(dir, "node_modules", "x", "d.js"), "x");
});

afterAll(() => {
	fs.rmSync(dir, { recursive: true, force: true });
});

describe("node file system", () => {
	it("lists files recursively, skipping dot folders and node_modules", () => {
		const rels = nodeFileSystem
			.listFiles(dir)
			.map((f) => f.rel)
			.sort();
		expect(rels).toEqual(["a.csv", "sub/b.json"]);
		const a = nodeFileSystem.listFiles(dir).find((f) => f.rel === "a.csv");
		expect(a?.size).toBe(8);
		expect(a?.mtime).toBeGreaterThan(0);
		expect(nodeFileSystem.isDirectory(dir)).toBe(true);
		expect(nodeFileSystem.isDirectory(path.join(dir, "a.csv"))).toBe(false);
		expect(nodeFileSystem.listFiles(path.join(dir, "missing"))).toEqual([]);
	});

	it("hashes whole files with sha256 and caps long ones", async () => {
		const p = path.join(dir, "a.csv");
		const whole = await nodeFileSystem.hashFile(p, 64 * 1024 * 1024);
		expect(whole).toEqual({ hash: createHash("sha256").update("a,b\n1,2\n").digest("hex"), truncated: false });
		expect(shortHash(whole.hash)).toHaveLength(12);
		const capped = await nodeFileSystem.hashFile(p, 3);
		expect(capped).toEqual({ hash: createHash("sha256").update("a,b").digest("hex"), truncated: true });
	});

	it("reads text with a byte cap and stats single files", () => {
		expect(nodeFileSystem.readText(path.join(dir, "sub", "b.json"), 1024)).toBe('{"lr": 0.1}');
		expect(nodeFileSystem.readText(path.join(dir, "sub", "b.json"), 5)).toBe('{"lr"');
		expect(nodeFileSystem.readText(path.join(dir, "nope"), 5)).toBe("");
		expect(nodeFileSystem.stat(path.join(dir, "a.csv"))).toMatchObject({ rel: "a.csv", size: 8 });
		expect(nodeFileSystem.stat(dir)).toBeNull();
	});
});
