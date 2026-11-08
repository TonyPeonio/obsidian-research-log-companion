import { Notice, Platform, Plugin, normalizePath, requestUrl } from "obsidian";
import { renderCompare, renderFindResults, findByParam } from "./core/compare";
import { DAY_MS, isoWeek } from "./core/dates";
import { ENTRY_TYPE_LABELS, appendEntry, newestFirst, parseLog, renderEntry, type Entry, type EntryType } from "./core/entry";
import { gitInfo } from "./core/git";
import { queriesHeader, upsertSection } from "./core/notes";
import { OllamaClient, explainOllamaError } from "./core/ollama";
import { collectProvenance } from "./core/provenance";
import { checkCitations, normaliseSections, renderReportNote, reportFileName, reportSystemPrompt, reportUntil, reportUserMessage } from "./core/report";
import { cardFileName, renderReproCard } from "./core/repro";
import { renderTimeline } from "./core/timeline";
import { readNoteOrEmpty, writeNote } from "./core/vault";
import { EntryModal, PickModal, PromptModal, entryLabel, projectLabel } from "./modals";
import { gitAvailable, makeRunGit, nodeFileSystem } from "./node-fs";
import { ObsidianVault } from "./obsidian-vault";
import { DEFAULT_SETTINGS, migrateSettings, projectFolder, type Project, type ResearchLogSettings } from "./settings";
import { ResearchLogSettingTab } from "./settings-tab";

export default class ResearchLogPlugin extends Plugin {
	settings: ResearchLogSettings = { ...DEFAULT_SETTINGS };
	client!: OllamaClient;
	vault!: ObsidianVault;
	private hasGit: boolean | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.vault = new ObsidianVault(this.app);
		this.client = new OllamaClient(
			() => this.settings.ollamaUrl,
			(...args) => fetch(...args),
			async (url, body, method) => {
				const res = await requestUrl(method === "GET" ? { url, method, throw: false } : { url, method, contentType: "application/json", body, throw: false });
				return { status: res.status, text: res.text };
			},
		);
		this.addSettingTab(new ResearchLogSettingTab(this.app, this));

		this.addRibbonIcon("flask-conical", "Log an entry", () => void this.logEntry());
		this.addCommand({ id: "log-entry", name: "Log an entry", callback: () => void this.logEntry() });
		this.addCommand({ id: "log-run", name: "Log an experiment", callback: () => void this.logEntry("run") });
		this.addCommand({ id: "log-result", name: "Log a result", callback: () => void this.logEntry("result") });
		this.addCommand({ id: "log-decision", name: "Log a decision", callback: () => void this.logEntry("decision") });
		this.addCommand({ id: "log-idea", name: "Log an idea", callback: () => void this.logEntry("idea") });
		this.addCommand({ id: "show-timeline", name: "Show project timeline", callback: () => void this.showTimeline() });
		this.addCommand({ id: "compare-runs", name: "Compare two runs", callback: () => void this.compareRuns() });
		this.addCommand({ id: "find-runs", name: "Find runs by parameter", callback: () => void this.findRuns() });
		this.addCommand({ id: "weekly-report", name: "Write this week's report", callback: () => void this.weeklyReport() });
		this.addCommand({ id: "export-card", name: "Export reproducibility card", callback: () => void this.exportCard() });
	}

	// ---------------------------------------------------------------- helpers

	private async pickProject(): Promise<Project | null> {
		const projects = this.settings.projects;
		if (projects.length === 0) {
			new Notice("Add a project in the Research Log Companion settings first.", 8000);
			return null;
		}
		if (projects.length === 1) return projects[0];
		const sorted = [...projects].sort((a, b) => (a.id === this.settings.lastProjectId ? -1 : b.id === this.settings.lastProjectId ? 1 : 0));
		const modal = new PickModal(this.app, sorted, projectLabel, "Which project?");
		modal.open();
		const p = await modal.result;
		if (p) await this.remember(p);
		return p;
	}

	private async remember(p: Project): Promise<void> {
		if (this.settings.lastProjectId !== p.id) {
			this.settings.lastProjectId = p.id;
			await this.saveSettings();
		}
	}

	private async loadEntries(p: Project): Promise<Entry[]> {
		return parseLog(await readNoteOrEmpty(this.vault, p.logPath));
	}

	private queriesPath(p: Project): string {
		return normalizePath(`${projectFolder(p, this.settings.outputFolder)}/${p.name} queries.md`);
	}

	private async writeQuery(p: Project, heading: string, body: string): Promise<string> {
		const path = this.queriesPath(p);
		const current = await readNoteOrEmpty(this.vault, path);
		await writeNote(this.vault, path, upsertSection(current, heading, body, queriesHeader(p.name)));
		await this.app.workspace.openLinkText(`${path}#${heading}`, "", false);
		return path;
	}

	private runGitFor(repoPath: string) {
		if (!Platform.isDesktopApp) return null;
		if (this.hasGit === null) this.hasGit = gitAvailable();
		return this.hasGit ? makeRunGit(repoPath) : null;
	}

	private async pickEntry(entries: Entry[], placeholder: string, filter?: (e: Entry) => boolean): Promise<Entry | null> {
		const list = newestFirst(filter ? entries.filter(filter) : entries);
		if (list.length === 0) {
			new Notice("No matching entries in this log yet.");
			return null;
		}
		const modal = new PickModal(this.app, list, entryLabel, placeholder);
		modal.open();
		return modal.result;
	}

	// ---------------------------------------------------------------- commands

	async logEntry(type?: EntryType): Promise<void> {
		if (this.settings.projects.length === 0) {
			new Notice("Add a project in the Research Log Companion settings first.", 8000);
			return;
		}
		const modal = new EntryModal(this.app, this.settings.projects, { type: type ?? "run", projectId: this.settings.lastProjectId, lockType: type !== undefined });
		modal.open();
		const input = await modal.result;
		if (!input) return;
		const project = this.settings.projects.find((p) => p.id === input.projectId);
		if (!project) return;
		await this.remember(project);

		const notice = new Notice("Collecting provenance…", 0);
		try {
			const existing = await this.loadEntries(project);
			const { entry, warnings } = await collectProvenance(project, input, {
				now: new Date(),
				existing,
				fs: nodeFileSystem,
				runGit: project.repoPath.trim() ? this.runGitFor(project.repoPath.trim()) : null,
				listImages: (folder) => this.vault.listImages(folder),
			});
			const current = await readNoteOrEmpty(this.vault, project.logPath);
			await writeNote(this.vault, project.logPath, appendEntry(current, renderEntry(entry), project.name));
			notice.hide();
			const bits: string[] = [];
			if (entry.commit) bits.push(`${entry.commit}${entry.dirty ? " dirty" : ""}`);
			if (Object.keys(entry.params).length) bits.push(`${Object.keys(entry.params).length} params`);
			if (entry.data.length) bits.push(`${entry.data.length} data file${entry.data.length === 1 ? "" : "s"}`);
			if (entry.figures.length) bits.push(`${entry.figures.length} figure${entry.figures.length === 1 ? "" : "s"}`);
			new Notice(`${ENTRY_TYPE_LABELS[entry.type]} logged to ${project.logPath}${bits.length ? ` (${bits.join(", ")})` : ""}.`, 6000);
			for (const w of warnings) new Notice(w, 8000);
		} catch (err) {
			notice.hide();
			new Notice(`Could not log the entry: ${(err as Error).message}`, 10000);
		}
	}

	/** Runs a query command; any vault or git failure ends in a Notice instead of a silent rejection. */
	private async guarded(what: string, fn: () => Promise<void>): Promise<void> {
		try {
			await fn();
		} catch (err) {
			new Notice(`Could not ${what}: ${(err as Error).message}`, 10000);
		}
	}

	async showTimeline(): Promise<void> {
		const p = await this.pickProject();
		if (!p) return;
		await this.guarded("write the timeline", async () => {
			const entries = await this.loadEntries(p);
			await this.writeQuery(p, "Timeline", renderTimeline(entries, p.logPath));
			new Notice(`Timeline of ${entries.length} entries written.`);
		});
	}

	async compareRuns(): Promise<void> {
		const p = await this.pickProject();
		if (!p) return;
		await this.guarded("compare the runs", async () => {
			const entries = await this.loadEntries(p);
			const runs = entries.filter((e) => e.type === "run" || e.type === "result");
			if (runs.length < 2) {
				new Notice("Compare needs at least two run or result entries.");
				return;
			}
			const a = await this.pickEntry(runs, "First run (A)");
			if (!a) return;
			const b = await this.pickEntry(runs, "Second run (B)", (e) => e.id !== a.id);
			if (!b) return;
			await this.writeQuery(p, `Compare ${a.id} vs ${b.id}`, renderCompare(a, b, p.logPath));
		});
	}

	async findRuns(): Promise<void> {
		const p = await this.pickProject();
		if (!p) return;
		const modal = new PromptModal(this.app, "Find runs by parameter", "Type key=value pairs separated by spaces, e.g. lr=3e-4 batch=64. A bare key matches any entry that recorded it. Numbers compare by value.", "lr=3e-4");
		modal.open();
		const query = await modal.result;
		if (!query) return;
		await this.guarded("search the log", async () => {
			const entries = await this.loadEntries(p);
			const matches = findByParam(entries, query);
			await this.writeQuery(p, `Runs with ${query}`, renderFindResults(query, matches, p.logPath));
			new Notice(`${matches.length} entr${matches.length === 1 ? "y" : "ies"} match ${query}.`);
		});
	}

	async weeklyReport(): Promise<void> {
		const p = await this.pickProject();
		if (!p) return;
		const until = new Date();
		const folder = projectFolder(p, this.settings.outputFolder);
		let since = new Date(until.getTime() - 7 * DAY_MS);
		let entries: Entry[];
		try {
			entries = await this.loadEntries(p);
			// Since the last report, when one exists and is newer than seven days ago.
			const prefix = `${folder}/${p.name} report `;
			const reports = this.vault.listNotes(folder).filter((path) => path.startsWith(prefix));
			for (const path of reports) {
				const u = reportUntil(await this.vault.read(path));
				if (u !== null && u > since.getTime() && u < until.getTime()) since = new Date(u);
			}
		} catch (err) {
			new Notice(`Could not read the log: ${(err as Error).message}`, 10000);
			return;
		}
		const window = entries.filter((e) => e.time > since.getTime() && e.time <= until.getTime());
		if (window.length === 0) {
			new Notice(`No entries since ${since.toLocaleString()}; nothing to report.`, 8000);
			return;
		}
		const { message, truncated } = reportUserMessage({ since, until, entries: window }, this.settings.numCtx);
		const notice = new Notice(`Writing the report from ${window.length} entries with ${this.settings.model}…`, 0);
		try {
			const reply = await this.client.chat({
				model: this.settings.model,
				messages: [
					{ role: "system", content: reportSystemPrompt(p.logPath) },
					{ role: "user", content: message },
				],
				options: { num_ctx: this.settings.numCtx, temperature: this.settings.temperature, top_p: 0.9, top_k: 20 },
				keep_alive: "10m",
				think: this.settings.thinking ? true : false,
			});
			const known = new Set(entries.map((e) => e.id));
			const checked = checkCitations(normaliseSections(reply), known, p.logPath);
			const note = renderReportNote(
				{ projectName: p.name, logPath: p.logPath, since, until, model: this.settings.model, entryCount: window.length, truncated, uncited: checked.uncited, unknown: checked.unknown },
				checked.markdown,
			);
			const path = normalizePath(`${folder}/${reportFileName(p.name, isoWeek(until))}`);
			await writeNote(this.vault, path, note);
			notice.hide();
			await this.app.workspace.openLinkText(path, "", false);
			new Notice(`Report written to ${path}.${checked.uncited ? ` ${checked.uncited} bullets lack a citation.` : ""}`, 8000);
		} catch (err) {
			notice.hide();
			new Notice(explainOllamaError(err, this.settings.model, this.settings.ollamaUrl), 10000);
		}
	}

	async exportCard(): Promise<void> {
		const p = await this.pickProject();
		if (!p) return;
		await this.guarded("export the card", async () => {
			const entries = await this.loadEntries(p);
			const entry = await this.pickEntry(entries, "Which result?", (e) => e.type === "result" || e.type === "run");
			if (!entry) return;
			let remoteUrl: string | undefined;
			if (p.repoPath.trim()) {
				const info = gitInfo(this.runGitFor(p.repoPath.trim()), p.repoPath.trim());
				if (info.ok) remoteUrl = info.remoteUrl;
			}
			const related = entries.filter((e) => e.id !== entry.id && e.commit && e.commit === entry.commit).slice(0, 10);
			const content = renderReproCard({ entry, projectName: p.name, logPath: p.logPath, repoPath: p.repoPath, remoteUrl, related });
			const path = normalizePath(`${projectFolder(p, this.settings.outputFolder)}/${cardFileName(p.name, entry)}`);
			await writeNote(this.vault, path, content);
			await this.app.workspace.openLinkText(path, "", false);
			new Notice(`Reproducibility card written to ${path}.`);
		});
	}

	// ---------------------------------------------------------------- settings

	async loadSettings(): Promise<void> {
		this.settings = migrateSettings(await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
