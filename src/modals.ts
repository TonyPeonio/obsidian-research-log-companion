import { App, Modal, Setting, SuggestModal } from "obsidian";
import { ENTRY_TYPES, ENTRY_TYPE_LABELS, type Entry, type EntryType } from "./core/entry";
import type { EntryInput } from "./core/provenance";
import { oneLine } from "./core/timeline";
import type { Project } from "./settings";

export interface EntryModalResult extends EntryInput {
	projectId: string;
}

/** Two fields (what / notes) plus a type picker and, with several projects, a project picker. */
export class EntryModal extends Modal {
	private resolve!: (r: EntryModalResult | null) => void;
	readonly result: Promise<EntryModalResult | null>;
	private done = false;
	private value: EntryModalResult;
	private errorEl: HTMLElement | null = null;
	private lockType: boolean;

	constructor(
		app: App,
		private projects: Project[],
		initial: { type: EntryType; projectId: string; lockType: boolean },
	) {
		super(app);
		this.lockType = initial.lockType;
		this.value = { type: initial.type, what: "", notes: "", projectId: initial.projectId || projects[0]?.id || "" };
		this.result = new Promise((res) => (this.resolve = res));
	}

	onOpen(): void {
		const { contentEl, titleEl, modalEl } = this;
		modalEl.addClass("rlc-modal");
		titleEl.setText(this.lockType ? `Log ${article(this.value.type)} ${ENTRY_TYPE_LABELS[this.value.type].toLowerCase()}` : "Log an entry");
		contentEl.createEl("p", {
			cls: "rlc-modal-help",
			text: "The entry is appended to the project's log note with the git commit, changed parameters, changed data files and new figures filled in automatically.",
		});

		if (this.projects.length > 1) {
			new Setting(contentEl).setName("Project").addDropdown((d) => {
				for (const p of this.projects) d.addOption(p.id, p.name);
				d.setValue(this.value.projectId).onChange((v) => (this.value.projectId = v));
			});
		}

		if (!this.lockType) {
			new Setting(contentEl).setName("Type").addDropdown((d) => {
				for (const t of ENTRY_TYPES) d.addOption(t, ENTRY_TYPE_LABELS[t]);
				d.setValue(this.value.type).onChange((v) => (this.value.type = v as EntryType));
			});
		}

		new Setting(contentEl)
			.setName(whatLabel(this.value.type))
			.setDesc("One line. This is what the timeline and the report show.")
			.addText((t) => {
				t.setPlaceholder("e.g. baseline with lr 3e-4 on the cleaned split").onChange((v) => (this.value.what = v));
				t.inputEl.addClass("rlc-modal-wide");
				t.inputEl.addEventListener("keydown", (ev) => {
					if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) this.submit();
				});
				window.setTimeout(() => t.inputEl.focus(), 0);
			});

		new Setting(contentEl)
			.setName("Notes")
			.setDesc("Optional. Anything you want to find again. Ctrl/Cmd+Enter submits.")
			.addTextArea((t) => {
				t.setPlaceholder("observations, why, what to try next…").onChange((v) => (this.value.notes = v));
				t.inputEl.addClass("rlc-modal-textarea");
				t.inputEl.rows = 5;
				t.inputEl.addEventListener("keydown", (ev) => {
					if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) this.submit();
				});
			});

		this.errorEl = contentEl.createEl("p", { cls: "rlc-modal-error" });

		new Setting(contentEl)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.finish(null)))
			.addButton((b) => b.setButtonText("Append entry").setCta().onClick(() => this.submit()));
	}

	private submit(): void {
		if (!this.value.what.trim()) {
			this.errorEl?.setText("Say what you ran or what happened; notes can stay empty.");
			return;
		}
		if (!this.value.projectId) {
			this.errorEl?.setText("Add a project in the settings first.");
			return;
		}
		this.finish(this.value);
	}

	private finish(r: EntryModalResult | null): void {
		if (this.done) return;
		this.done = true;
		this.resolve(r);
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
		this.finish(null);
	}
}

function article(t: EntryType): string {
	return t === "idea" ? "an" : "a";
}

function whatLabel(t: EntryType): string {
	switch (t) {
		case "run":
			return "What you ran";
		case "result":
			return "What happened";
		case "decision":
			return "What you decided";
		case "idea":
			return "The idea";
	}
}

/** Generic chooser over a list; resolves null when dismissed. */
export class PickModal<T> extends SuggestModal<T> {
	private resolve!: (r: T | null) => void;
	readonly result: Promise<T | null>;
	private done = false;

	constructor(
		app: App,
		private items: T[],
		private label: (item: T) => { title: string; detail?: string },
		placeholder: string,
	) {
		super(app);
		this.setPlaceholder(placeholder);
		this.result = new Promise((res) => (this.resolve = res));
	}

	getSuggestions(query: string): T[] {
		const q = query.toLowerCase().trim();
		if (!q) return this.items;
		return this.items.filter((it) => {
			const l = this.label(it);
			return `${l.title} ${l.detail ?? ""}`.toLowerCase().includes(q);
		});
	}

	renderSuggestion(item: T, el: HTMLElement): void {
		const l = this.label(item);
		el.createDiv({ text: l.title });
		if (l.detail) el.createEl("small", { text: l.detail, cls: "rlc-pick-detail" });
	}

	onChooseSuggestion(item: T): void {
		if (this.done) return;
		this.done = true;
		this.resolve(item);
	}

	onClose(): void {
		super.onClose();
		window.setTimeout(() => {
			if (!this.done) {
				this.done = true;
				this.resolve(null);
			}
		}, 0);
	}
}

export function entryLabel(e: Entry): { title: string; detail?: string } {
	const bits: string[] = [];
	if (e.commit) bits.push(e.commit);
	const params = Object.entries(e.params)
		.slice(0, 4)
		.map(([k, v]) => `${k}=${v}`)
		.join(", ");
	if (params) bits.push(params);
	if (e.data.length) bits.push(`${e.data.length} data`);
	return { title: `${e.id}${e.what ? ` — ${oneLine(e.what, 70)}` : ""}`, detail: bits.join(" · ") || undefined };
}

export function projectLabel(p: Project): { title: string; detail?: string } {
	return { title: p.name, detail: p.logPath };
}

/** One text field; resolves null when cancelled. */
export class PromptModal extends Modal {
	private resolve!: (r: string | null) => void;
	readonly result: Promise<string | null>;
	private done = false;
	private value = "";

	constructor(
		app: App,
		private title: string,
		private help: string,
		private placeholder: string,
	) {
		super(app);
		this.result = new Promise((res) => (this.resolve = res));
	}

	onOpen(): void {
		const { contentEl, titleEl, modalEl } = this;
		modalEl.addClass("rlc-modal");
		titleEl.setText(this.title);
		contentEl.createEl("p", { cls: "rlc-modal-help", text: this.help });
		new Setting(contentEl).addText((t) => {
			t.setPlaceholder(this.placeholder).onChange((v) => (this.value = v));
			t.inputEl.addClass("rlc-modal-wide");
			t.inputEl.addEventListener("keydown", (ev) => {
				if (ev.key === "Enter") this.finish(this.value);
			});
			window.setTimeout(() => t.inputEl.focus(), 0);
		});
		new Setting(contentEl)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.finish(null)))
			.addButton((b) => b.setButtonText("Search").setCta().onClick(() => this.finish(this.value)));
	}

	private finish(v: string | null): void {
		if (this.done) return;
		this.done = true;
		this.resolve(v && v.trim() ? v.trim() : null);
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
		this.finish(null);
	}
}
