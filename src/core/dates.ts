// Timestamps and ISO weeks, all in local time. No Obsidian import.

const pad = (n: number) => String(n).padStart(2, "0");

/** `2026-11-07 21:14` in local time; this is the entry id's first half. */
export function formatStamp(d: Date): string {
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Inverse of `formatStamp`; null when the text is not a stamp. */
export function parseStamp(text: string): Date | null {
	const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(text.trim());
	if (!m) return null;
	const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
	return Number.isNaN(d.getTime()) ? null : d;
}

/** `2026-11-07` in local time. */
export function formatDate(d: Date): string {
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Monday 00:00 local of the week containing `d`. */
export function weekStart(d: Date): Date {
	const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
	const day = (out.getDay() + 6) % 7; // Monday = 0
	out.setDate(out.getDate() - day);
	return out;
}

/** ISO 8601 week label such as `2026-W45`. */
export function isoWeek(d: Date): string {
	// Thursday of the same ISO week decides the year.
	const thursday = new Date(d.getFullYear(), d.getMonth(), d.getDate());
	thursday.setDate(thursday.getDate() + 3 - ((thursday.getDay() + 6) % 7));
	const year = thursday.getFullYear();
	const jan4 = new Date(year, 0, 4);
	const firstThursday = new Date(jan4);
	firstThursday.setDate(jan4.getDate() + 3 - ((jan4.getDay() + 6) % 7));
	const week = 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
	return `${year}-W${pad(week)}`;
}

export const DAY_MS = 86_400_000;
