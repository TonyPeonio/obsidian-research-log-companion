// Settings shape, defaults and migration from older or partial `data.json` contents.
// No Obsidian import, so the migration is unit-tested.

export interface Project {
	id: string;
	name: string;
	/** Vault-relative path of the log note, e.g. `Research/Thesis log.md`. */
	logPath: string;
	/** Absolute path of the code repository, or "". */
	repoPath: string;
	/** Absolute paths of watched data/results folders. */
	dataFolders: string[];
	/** Vault-relative folder with figures (so `![[...]]` embeds work), or "". */
	figuresFolder: string;
}

export interface ResearchLogSettings {
	version: 1;
	projects: Project[];
	ollamaUrl: string;
	model: string;
	numCtx: number;
	temperature: number;
	/** Reasoning on thinking-capable models; off by default. */
	thinking: boolean;
	/** Folder for queries, reports and cards when a project's log is at the vault root. */
	outputFolder: string;
	lastProjectId: string;
}

export const SETTINGS_VERSION = 1;

export const DEFAULT_SETTINGS: ResearchLogSettings = {
	version: 1,
	projects: [],
	ollamaUrl: "http://localhost:11434",
	model: "qwen3.5:9b",
	numCtx: 16384,
	temperature: 0.2,
	thinking: false,
	outputFolder: "Research",
	lastProjectId: "",
};

export function defaultLogPath(name: string, folder = DEFAULT_SETTINGS.outputFolder): string {
	return `${folder}/${name.trim() || "Project"} log.md`;
}

export function newProject(name: string, folder = DEFAULT_SETTINGS.outputFolder): Project {
	return { id: makeId(), name: name.trim() || "Project", logPath: defaultLogPath(name, folder), repoPath: "", dataFolders: [], figuresFolder: "" };
}

export function makeId(): string {
	return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/** Folder a project's derived notes (queries, reports, cards) go in: next to its log. */
export function projectFolder(p: Project, fallback: string): string {
	const i = p.logPath.lastIndexOf("/");
	return i < 0 ? fallback : p.logPath.slice(0, i);
}

function str(v: unknown, fallback: string): string {
	return typeof v === "string" ? v : fallback;
}

function num(v: unknown, fallback: number): number {
	return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function strList(v: unknown): string[] {
	if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean);
	if (typeof v === "string")
		return v
			.split(/\r?\n|;/)
			.map((x) => x.trim())
			.filter(Boolean);
	return [];
}

function migrateProject(raw: unknown, index: number, folder: string): Project | null {
	if (!raw || typeof raw !== "object") return null;
	const r = raw as Record<string, unknown>;
	const name = str(r.name, `Project ${index + 1}`).trim() || `Project ${index + 1}`;
	return {
		id: str(r.id, "") || makeId(),
		name,
		logPath: str(r.logPath, "") || defaultLogPath(name, folder),
		repoPath: str(r.repoPath, str(r.repo, "")),
		dataFolders: strList(r.dataFolders ?? r.dataFolder),
		figuresFolder: str(r.figuresFolder, ""),
	};
}

/**
 * Accepts anything that was ever written to data.json: the current shape, a partial one, or
 * the pre-release single-project shape (`logPath`/`repoPath`/`dataFolders` at the top level).
 */
export function migrateSettings(raw: unknown): ResearchLogSettings {
	const out: ResearchLogSettings = { ...DEFAULT_SETTINGS, projects: [] };
	if (!raw || typeof raw !== "object") return out;
	const r = raw as Record<string, unknown>;
	out.ollamaUrl = str(r.ollamaUrl, out.ollamaUrl).trim() || DEFAULT_SETTINGS.ollamaUrl;
	out.model = str(r.model, out.model).trim() || DEFAULT_SETTINGS.model;
	out.numCtx = Math.min(262_144, Math.max(2048, Math.round(num(r.numCtx, out.numCtx))));
	out.temperature = Math.min(2, Math.max(0, num(r.temperature, out.temperature)));
	out.thinking = typeof r.thinking === "boolean" ? r.thinking : out.thinking;
	out.outputFolder = str(r.outputFolder, out.outputFolder).trim().replace(/^\/+|\/+$/g, "") || DEFAULT_SETTINGS.outputFolder;
	out.lastProjectId = str(r.lastProjectId, "");

	if (Array.isArray(r.projects)) {
		out.projects = r.projects.map((p, i) => migrateProject(p, i, out.outputFolder)).filter((p): p is Project => p !== null);
	} else if (typeof r.logPath === "string" || typeof r.repoPath === "string" || typeof r.projectName === "string") {
		// Pre-release single-project layout.
		const p = migrateProject({ name: r.projectName ?? "Project", logPath: r.logPath, repoPath: r.repoPath, dataFolders: r.dataFolders, figuresFolder: r.figuresFolder }, 0, out.outputFolder);
		if (p) out.projects = [p];
	}
	// Ids must be unique; duplicates get fresh ones.
	const seen = new Set<string>();
	for (const p of out.projects) {
		while (seen.has(p.id)) p.id = makeId();
		seen.add(p.id);
	}
	if (out.lastProjectId && !out.projects.some((p) => p.id === out.lastProjectId)) out.lastProjectId = "";
	out.version = SETTINGS_VERSION;
	return out;
}
