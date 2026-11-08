// Section upsert for the queries note: a `## heading` section is replaced in place when it
// exists and appended otherwise, so repeated queries do not pile up.

export function queriesHeader(projectName: string): string {
	return `---\nproject: ${projectName}\ntype: research-queries\n---\n\n# ${projectName} queries\n\nWritten by Research Log Companion. Each \`##\` section is replaced when the same query runs again.\n`;
}

/** Index of the line a `## heading` starts on, or -1. */
function findSection(lines: string[], heading: string): number {
	const target = `## ${heading}`.trim();
	return lines.findIndex((l) => l.trim() === target);
}

export function upsertSection(content: string, heading: string, body: string, headerIfEmpty: string): string {
	const base = content.trim() ? content.replace(/\r\n?/g, "\n") : headerIfEmpty;
	const lines = base.split("\n");
	const section = `## ${heading}\n\n${body.trim()}\n`;
	const start = findSection(lines, heading);
	if (start < 0) {
		const sep = base.endsWith("\n\n") ? "" : base.endsWith("\n") ? "\n" : "\n\n";
		return base + sep + section;
	}
	let end = start + 1;
	while (end < lines.length && !/^## /.test(lines[end])) end++;
	const before = lines.slice(0, start).join("\n");
	const after = lines.slice(end).join("\n");
	return `${before.trimEnd()}\n\n${section}${after.trim() ? `\n${after.trimStart()}` : ""}`;
}
