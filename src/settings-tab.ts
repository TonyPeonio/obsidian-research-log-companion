import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type ResearchLogPlugin from "./main";
import { repoPathProblem } from "./core/git";
import { DEFAULT_SETTINGS, defaultLogPath, newProject, type Project } from "./settings";

export class ResearchLogSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: ResearchLogPlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const s = this.plugin.settings;

		new Setting(containerEl).setName("Projects").setHeading();
		containerEl.createEl("p", {
			cls: "rlc-settings-help",
			text: "Each project has one append-only log note. The code repository and data folders are absolute paths on this machine; the figures folder is a folder inside the vault so embeds work.",
		});

		if (s.projects.length === 0) containerEl.createEl("p", { cls: "rlc-settings-help", text: "No projects yet. Add one to start logging." });

		s.projects.forEach((p, index) => this.renderProject(containerEl, p, index));

		new Setting(containerEl).addButton((b) =>
			b
				.setButtonText("Add project")
				.setCta()
				.onClick(async () => {
					s.projects.push(newProject(`Project ${s.projects.length + 1}`, s.outputFolder));
					await this.plugin.saveSettings();
					this.display();
				}),
		);

		new Setting(containerEl)
			.setName("Default folder for new projects")
			.setDesc("New projects get their log at <folder>/<name> log.md. Queries, reports and cards are written next to each project's log.")
			.addText((t) =>
				t.setPlaceholder(DEFAULT_SETTINGS.outputFolder).setValue(s.outputFolder).onChange(async (v) => {
					s.outputFolder = v.trim().replace(/^\/+|\/+$/g, "") || DEFAULT_SETTINGS.outputFolder;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl).setName("Weekly report model").setHeading();
		containerEl.createEl("p", {
			cls: "rlc-settings-help",
			text: "Only Write this week's report talks to a model. Everything else is deterministic and offline.",
		});

		new Setting(containerEl)
			.setName("Ollama URL")
			.setDesc("Where Ollama is listening. Nothing else is contacted.")
			.addText((t) =>
				t.setPlaceholder(DEFAULT_SETTINGS.ollamaUrl).setValue(s.ollamaUrl).onChange(async (v) => {
					s.ollamaUrl = v.trim() || DEFAULT_SETTINGS.ollamaUrl;
					await this.plugin.saveSettings();
				}),
			)
			.addButton((b) =>
				b.setButtonText("Test connection").onClick(async () => {
					try {
						const version = await this.plugin.client.version();
						const models = await this.plugin.client.listModels();
						const has = models.some((m) => m.name === s.model);
						new Notice(`Connected to Ollama ${version} (${models.length} models).${has ? "" : ` Model "${s.model}" is not installed: run \`ollama pull ${s.model}\`.`}`, 8000);
					} catch (err) {
						new Notice(`Connection failed: ${(err as Error).message}`, 8000);
					}
				}),
			);

		const modelSetting = new Setting(containerEl).setName("Chat model").setDesc("Any Ollama chat model. qwen3.5:9b fits a 12 GB GPU.");
		modelSetting.addDropdown(async (d) => {
			d.addOption(s.model, s.model);
			d.setValue(s.model);
			try {
				const models = await this.plugin.client.listModels();
				d.selectEl.empty();
				const names = models.filter((m) => !/embed/i.test(m.name)).map((m) => m.name);
				if (!names.includes(s.model)) names.unshift(s.model);
				for (const n of names) d.addOption(n, n);
				d.setValue(s.model);
			} catch {
				// Ollama unreachable: keep the single current value.
			}
			d.onChange(async (v) => {
				s.model = v;
				await this.plugin.saveSettings();
			});
		});
		modelSetting.addText((t) =>
			t.setPlaceholder("or type a model name").onChange(async (v) => {
				if (!v.trim()) return;
				s.model = v.trim();
				await this.plugin.saveSettings();
			}),
		);

		new Setting(containerEl)
			.setName("Context window (num_ctx)")
			.setDesc("Tokens the model can see. A week of entries fits easily in 16384; raise it if the report says entries were trimmed.")
			.addText((t) =>
				t.setValue(String(s.numCtx)).onChange(async (v) => {
					const n = parseInt(v, 10);
					if (Number.isFinite(n) && n >= 2048 && n <= 262144) {
						s.numCtx = n;
						await this.plugin.saveSettings();
					}
				}),
			);

		new Setting(containerEl)
			.setName("Thinking mode")
			.setDesc("Let thinking-capable models reason before writing. Off by default: the report only restates entries.")
			.addToggle((t) =>
				t.setValue(s.thinking).onChange(async (v) => {
					s.thinking = v;
					await this.plugin.saveSettings();
				}),
			);
	}

	private renderProject(containerEl: HTMLElement, p: Project, index: number): void {
		const s = this.plugin.settings;
		const box = containerEl.createDiv({ cls: "rlc-project" });

		new Setting(box)
			.setName(`Project ${index + 1}`)
			.setDesc("Name")
			.addText((t) =>
				t.setPlaceholder("Thesis").setValue(p.name).onChange(async (v) => {
					const old = p.name;
					p.name = v.trim() || `Project ${index + 1}`;
					if (p.logPath === defaultLogPath(old, s.outputFolder)) p.logPath = defaultLogPath(p.name, s.outputFolder);
					await this.plugin.saveSettings();
				}),
			)
			.addExtraButton((b) =>
				b
					.setIcon("trash")
					.setTooltip("Remove this project (the log note stays)")
					.onClick(async () => {
						s.projects.splice(index, 1);
						await this.plugin.saveSettings();
						this.display();
					}),
			);

		new Setting(box)
			.setName("Log note")
			.setDesc("Vault path of the append-only log. Created on the first entry.")
			.addText((t) => {
				t.setPlaceholder(defaultLogPath(p.name)).setValue(p.logPath).onChange(async (v) => {
					let path = v.trim().replace(/^\/+/, "");
					if (path && !path.endsWith(".md")) path += ".md";
					p.logPath = path || defaultLogPath(p.name, s.outputFolder);
					await this.plugin.saveSettings();
				});
				t.inputEl.addClass("rlc-settings-wide");
			});

		const repoSetting = new Setting(box)
			.setName("Code repository folder")
			.setDesc("The folder on this machine where the repository is checked out, not its GitHub URL: git runs locally, so private repositories work and nothing is fetched. Branch, commit, dirty state and changed config files come from here. Optional.");
		const repoWarning = repoSetting.descEl.createDiv({ cls: "rlc-settings-warning" });
		const showRepoWarning = (path: string): void => {
			repoWarning.setText(repoPathProblem(path) ?? "");
		};
		showRepoWarning(p.repoPath);
		repoSetting.addText((t) => {
			t.setPlaceholder("C:\\Users\\you\\code\\thesis or /home/you/code/thesis")
				.setValue(p.repoPath)
				.onChange(async (v) => {
					p.repoPath = v.trim();
					showRepoWarning(p.repoPath);
					await this.plugin.saveSettings();
				});
			t.inputEl.addClass("rlc-settings-wide");
		});

		new Setting(box)
			.setName("Watched data folders")
			.setDesc("Absolute paths, one per line. Files changed since the previous entry are listed with size and sha256. Optional.")
			.addTextArea((t) => {
				t.setPlaceholder("D:\\experiments\\results")
					.setValue(p.dataFolders.join("\n"))
					.onChange(async (v) => {
						p.dataFolders = v
							.split(/\r?\n/)
							.map((x) => x.trim())
							.filter(Boolean);
						await this.plugin.saveSettings();
					});
				t.inputEl.addClass("rlc-settings-textarea");
				t.inputEl.rows = 3;
			});

		new Setting(box)
			.setName("Figures folder")
			.setDesc("Folder inside the vault. Images added since the previous entry are embedded. Optional.")
			.addText((t) => {
				t.setPlaceholder("Research/figures")
					.setValue(p.figuresFolder)
					.onChange(async (v) => {
						p.figuresFolder = v.trim().replace(/^\/+|\/+$/g, "");
						await this.plugin.saveSettings();
					});
				t.inputEl.addClass("rlc-settings-wide");
			});
	}
}
