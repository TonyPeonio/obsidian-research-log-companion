import { describe, expect, it } from "vitest";
import { OllamaClient, explainOllamaError, stripThinkTags } from "../src/core/ollama";

function streamOf(lines: object[]): ReadableStream<Uint8Array> {
	const enc = new TextEncoder();
	const text = lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
	return new ReadableStream({
		start(controller) {
			controller.enqueue(enc.encode(text.slice(0, 9)));
			controller.enqueue(enc.encode(text.slice(9)));
			controller.close();
		},
	});
}

const fakeFetch = (handler: (url: string, init?: RequestInit) => Response) => ((url: string | URL | Request, init?: RequestInit) => Promise.resolve(handler(String(url), init))) as typeof fetch;

describe("OllamaClient", () => {
	it("streams chat with thinking off and temperature, and uses GET for tags/version", async () => {
		let body = "";
		const client = new OllamaClient(
			() => "http://x/",
			fakeFetch((url, init) => {
				if (url.endsWith("/api/chat")) {
					body = String(init?.body);
					return new Response(streamOf([{ message: { content: "## Summary" } }, { message: { content: "\n- a" } }, { done: true }]));
				}
				if (url.endsWith("/api/tags") || url.endsWith("/api/version")) {
					if (init?.method !== "GET" || init.body !== undefined) return new Response("405 method not allowed", { status: 405 });
					return new Response(url.endsWith("/api/tags") ? JSON.stringify({ models: [{ name: "qwen3.5:9b", size: 1 }] }) : JSON.stringify({ version: "0.40.15" }));
				}
				return new Response("{}", { status: 404 });
			}),
		);
		expect(await client.version()).toBe("0.40.15");
		expect((await client.listModels()).map((m) => m.name)).toEqual(["qwen3.5:9b"]);
		const text = await client.chat({ model: "m", messages: [{ role: "user", content: "hi" }], think: false, options: { temperature: 0.2 } });
		expect(text).toBe("## Summary\n- a");
		expect(JSON.parse(body)).toMatchObject({ model: "m", stream: true, think: false, options: { temperature: 0.2 } });
	});

	it("falls back to the non-streaming poster and explains errors", async () => {
		const client = new OllamaClient(
			() => "http://x",
			fakeFetch(() => {
				throw new TypeError("Failed to fetch");
			}),
			async () => ({ status: 200, text: JSON.stringify({ message: { content: "<think>hmm</think>## Summary" } }) }),
		);
		expect(await client.chat({ model: "m", messages: [] })).toBe("## Summary");
		expect(stripThinkTags("<think>x</think> y")).toBe("y");
		expect(explainOllamaError(new Error("model 'q' not found, try pulling it"), "q", "http://x")).toContain("ollama pull q");
		expect(explainOllamaError(new TypeError("Failed to fetch"), "q", "http://x")).toContain("Cannot reach Ollama at http://x");
	});
});
