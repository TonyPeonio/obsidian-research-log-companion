import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, defaultLogPath, migrateSettings, newProject, projectFolder } from "../src/settings";

describe("settings migration", () => {
	it("returns defaults for nothing, garbage or an empty object", () => {
		expect(migrateSettings(null)).toEqual({ ...DEFAULT_SETTINGS, projects: [] });
		expect(migrateSettings("x")).toEqual({ ...DEFAULT_SETTINGS, projects: [] });
		expect(migrateSettings({})).toEqual({ ...DEFAULT_SETTINGS, projects: [] });
	});

	it("fills in missing project fields and converts a string data folder list", () => {
		const s = migrateSettings({ projects: [{ name: "Thesis", dataFolders: "D:\\a\nD:\\b", repo: "C:\\code" }, { id: "fixed", name: "" }, "junk"] });
		expect(s.projects).toHaveLength(2);
		expect(s.projects[0]).toMatchObject({ name: "Thesis", logPath: "Research/Thesis log.md", repoPath: "C:\\code", dataFolders: ["D:\\a", "D:\\b"], figuresFolder: "" });
		expect(s.projects[0].id).toMatch(/^p/);
		expect(s.projects[1]).toMatchObject({ id: "fixed", name: "Project 2", logPath: "Research/Project 2 log.md" });
	});

	it("upgrades the pre-release single-project layout", () => {
		const s = migrateSettings({ projectName: "Old", logPath: "Logs/old.md", repoPath: "/repo", dataFolders: ["/data"], ollamaUrl: "http://gpu:11434/", model: "qwen3.5:4b", thinking: true });
		expect(s.projects).toHaveLength(1);
		expect(s.projects[0]).toMatchObject({ name: "Old", logPath: "Logs/old.md", repoPath: "/repo", dataFolders: ["/data"] });
		expect(s.ollamaUrl).toBe("http://gpu:11434/");
		expect(s.model).toBe("qwen3.5:4b");
		expect(s.thinking).toBe(true);
		expect(s.version).toBe(1);
	});

	it("clamps numbers, de-duplicates ids and drops a stale lastProjectId", () => {
		const s = migrateSettings({ numCtx: 10, temperature: 9, projects: [{ id: "a", name: "x" }, { id: "a", name: "y" }], lastProjectId: "gone", outputFolder: "/Notes/" });
		expect(s.numCtx).toBe(2048);
		expect(s.temperature).toBe(2);
		expect(new Set(s.projects.map((p) => p.id)).size).toBe(2);
		expect(s.lastProjectId).toBe("");
		expect(s.outputFolder).toBe("Notes");
	});

	it("derives paths for new projects", () => {
		expect(defaultLogPath("Thesis")).toBe("Research/Thesis log.md");
		const p = newProject("  Fluids ", "Lab");
		expect(p.name).toBe("Fluids");
		expect(p.logPath).toBe("Lab/Fluids log.md");
		expect(projectFolder(p, "Research")).toBe("Lab");
		expect(projectFolder({ ...p, logPath: "root.md" }, "Research")).toBe("Research");
	});
});
