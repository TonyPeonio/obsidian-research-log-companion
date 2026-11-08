// Reproducibility card: one page per entry with everything needed to redo it.

import { formatStamp } from "./dates";
import { entryLink, formatSize, renderDataFile, type Entry } from "./entry";
import { browsableRemote } from "./git";

export interface CardInput {
	entry: Entry;
	projectName: string;
	logPath: string;
	repoPath: string;
	remoteUrl?: string;
	/** Earlier result/run entries whose commit matches, for context. Optional. */
	related?: Entry[];
}

export function cardFileName(projectName: string, entry: Entry): string {
	const safe = entry.id.replace(/:/g, "").replace(/ · /g, " ").replace(/[\\/:*?"<>|]/g, "");
	return `${projectName} card ${safe}.md`;
}

export function renderReproCard(input: CardInput): string {
	const { entry: e, projectName, logPath } = input;
	const web = browsableRemote(input.remoteUrl);
	const out: string[] = [];
	out.push("---");
	out.push(`project: ${projectName}`);
	out.push("type: reproducibility-card");
	out.push(`entry: "${e.id}"`);
	out.push(`entry_type: ${e.type}`);
	if (e.commit) out.push(`commit: ${e.commit}`);
	out.push("---");
	out.push("");
	out.push(`# ${projectName} — ${e.type} ${formatStamp(new Date(e.time))}`);
	out.push("");
	out.push(`Source entry: ${entryLink(logPath, e.id)}`);
	out.push("");
	out.push("## What");
	out.push("");
	out.push(e.what || "—");
	out.push("");
	out.push("## Code");
	out.push("");
	if (e.commit) {
		out.push(`- Commit: \`${e.commit}\` on \`${e.branch ?? "?"}\`${e.dirty ? " — **working tree had uncommitted changes**; the commit alone does not reproduce this." : " (clean working tree)"}`);
		if (web) out.push(`- Repository: ${web}${web.includes("github.com") || web.includes("gitlab.com") ? ` ([commit](${web}/commit/${e.commit}))` : ""}`);
		else if (input.remoteUrl) out.push(`- Repository: \`${input.remoteUrl}\``);
		else out.push(`- Repository: local only (${input.repoPath || "no path recorded"})`);
	} else out.push(`- ${e.repo ?? "No repository recorded."}`);
	if (e.command) {
		out.push("");
		out.push("Command line:");
		out.push("");
		out.push("```sh");
		out.push(e.command);
		out.push("```");
	}
	out.push("");
	out.push("## Parameters");
	out.push("");
	const params = Object.entries(e.params);
	if (params.length === 0) out.push("_None recorded._");
	else {
		if (e.paramsSource) out.push(`From \`${e.paramsSource}\`:`);
		out.push("");
		out.push("| Parameter | Value |");
		out.push("|---|---|");
		for (const [k, v] of params) out.push(`| ${k} | \`${v.replace(/\|/g, "\\|")}\` |`);
	}
	out.push("");
	out.push("## Data");
	out.push("");
	if (e.data.length === 0) out.push("_No data files recorded._");
	else {
		const total = e.data.reduce((s, d) => s + (Number.isFinite(d.size) ? d.size : 0), 0);
		out.push(`${e.data.length} file${e.data.length === 1 ? "" : "s"}, ${formatSize(total)} total. Hashes are sha256 prefixes${e.data.some((d) => d.truncated) ? "; files marked (first 64 MB) were hashed only up to that size" : ""}.`);
		out.push("");
		for (const d of e.data) out.push(`- ${renderDataFile(d)}`);
	}
	out.push("");
	out.push("## Figures");
	out.push("");
	if (e.figures.length === 0) out.push("_None._");
	else for (const f of e.figures) out.push(`![[${f}]]`);
	out.push("");
	out.push("## Notes");
	out.push("");
	out.push(e.notes || "—");
	if (input.related && input.related.length > 0) {
		out.push("");
		out.push("## Related entries");
		out.push("");
		for (const r of input.related) out.push(`- ${entryLink(logPath, r.id)}${r.what ? ` — ${r.what.split("\n")[0]}` : ""}`);
	}
	out.push("");
	return out.join("\n");
}
