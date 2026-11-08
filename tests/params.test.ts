import { describe, expect, it } from "vitest";
import { cliFlags, extractCommand, extractParams, isConfigFile, paramValuesEqual } from "../src/core/params";

describe("extractParams", () => {
	it("reads yaml key: value pairs, skipping comments and containers", () => {
		const yaml = ["# training config", "model: resnet-18", "lr: 3e-4   # initial", "batch: 64", "optimizer:", "  name: adamw", "  betas: [0.9, 0.999]", "tags: [a, b]", "notes: |", "  multi", "  line", "seed: 42"].join("\n");
		expect(extractParams(yaml, "configs/base.yaml")).toEqual({ model: "resnet-18", lr: "3e-4", batch: "64", name: "adamw", betas: "[0.9, 0.999]", tags: "[a, b]", seed: "42" });
	});

	it("reads json, flattening one level", () => {
		const json = JSON.stringify({ lr: 0.0003, batch: 64, model: { name: "resnet", depth: 18 }, layers: [64, 128], flag: true, nested: { deep: { x: 1 } } });
		expect(extractParams(json, "run.json")).toEqual({ lr: "0.0003", batch: "64", "model.name": "resnet", "model.depth": "18", layers: "[64,128]", flag: "true" });
	});

	it("falls back to line scanning for truncated json", () => {
		const json = '{\n  "lr": 0.001,\n  "batch": 32,\n  "name": "run7",\n  "big": {';
		expect(extractParams(json, "run.json")).toEqual({ lr: "0.001", batch: "32", name: "run7" });
	});

	it("reads shell assignments and cli flags from a slurm script", () => {
		const sh = ["#!/bin/bash", "#SBATCH --time=04:00:00", "export LR=3e-4", 'DATA="/scratch/data"', "python train.py --lr $LR --batch 64 --amp --config configs/base.yaml \\", "  --seed 7"].join("\n");
		expect(extractParams(sh, "jobs/train.slurm")).toEqual({ LR: "3e-4", DATA: "/scratch/data", lr: "$LR", batch: "64", amp: "true", config: "configs/base.yaml", seed: "7" });
	});

	it("prefixes toml and ini keys with their section", () => {
		expect(extractParams("[train]\nlr = 0.1\n[data]\npath = 'x'\n", "cfg.toml")).toEqual({ "train.lr": "0.1", "data.path": "x" });
	});

	it("caps at 12 params and 60 lines, truncating long values", () => {
		const lines = Array.from({ length: 80 }, (_, i) => `k${i}: ${i}`).join("\n");
		const out = extractParams(lines, "many.yaml");
		expect(Object.keys(out)).toHaveLength(12);
		expect(out.k0).toBe("0");
		const long = extractParams(`path: ${"x".repeat(100)}`, "a.yml");
		expect(long.path.length).toBe(40);
		expect(long.path.endsWith("…")).toBe(true);
	});

	it("knows which files count as config", () => {
		expect(isConfigFile("configs/base.yaml")).toBe(true);
		expect(isConfigFile("C:\\code\\run.SH")).toBe(true);
		expect(isConfigFile("train.py")).toBe(false);
	});
});

describe("command line and flags", () => {
	it("finds the command and joins continuation lines", () => {
		const sh = "#!/bin/bash\nset -e\ncd /work\npython train.py --lr 3e-4 \\\n  --batch 64\necho done\n";
		expect(extractCommand(sh)).toBe("python train.py --lr 3e-4 --batch 64");
		expect(extractCommand("# nothing\nVAR=1\n")).toBeUndefined();
	});

	it("parses flag forms", () => {
		expect(cliFlags("--lr=3e-4 -b 64 --amp --out dir/")).toEqual([
			["lr", "3e-4"],
			["b", "64"],
			["amp", "true"],
			["out", "dir/"],
		]);
	});

	it("compares numbers by value", () => {
		expect(paramValuesEqual("3e-4", "0.0003")).toBe(true);
		expect(paramValuesEqual("64", "64.0")).toBe(true);
		expect(paramValuesEqual("adamw", "AdamW")).toBe(false);
		expect(paramValuesEqual("", "0")).toBe(false);
	});
});
