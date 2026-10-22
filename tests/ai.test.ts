import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { rewrite, shouldRewrite } from "../aiWriter/ai.ts";

const cfg = { apiKey: "k", model: "m", prompt: "p" };

function fakeFetch(status: number, body: unknown) {
    const calls: { url: string; init: RequestInit; }[] = [];
    const fn = (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response(JSON.stringify(body), { status, statusText: "Status" });
    }) as unknown as typeof fetch;
    return { fn, calls };
}

const reply = (content: unknown) => ({ choices: [{ message: { content } }] });

describe("shouldRewrite", () => {
    it("accepts normal text", () => assert.equal(shouldRewrite("hi"), true));
    it("skips empty text", () => assert.equal(shouldRewrite(""), false));
    it("skips whitespace-only text", () => assert.equal(shouldRewrite("   \n"), false));
    it("skips slash commands", () => assert.equal(shouldRewrite("/shrug"), false));
});

describe("rewrite", () => {
    it("sends the expected request", async () => {
        const { fn, calls } = fakeFetch(200, reply("ok"));
        await rewrite("hello", cfg, fn);

        assert.equal(calls.length, 1);
        const { url, init } = calls[0];
        assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
        assert.equal(init.method, "POST");
        assert.equal((init.headers as Record<string, string>).Authorization, "Bearer k");
        assert.deepEqual(JSON.parse(init.body as string), {
            model: "m",
            messages: [
                { role: "system", content: "p" },
                { role: "user", content: "hello" }
            ]
        });
    });

    it("returns the trimmed reply", async () => {
        const { fn } = fakeFetch(200, reply("  Hi there!\n"));
        assert.equal(await rewrite("hello", cfg, fn), "Hi there!");
    });

    it("rejects without calling the API when no key is set", async () => {
        const { fn, calls } = fakeFetch(200, reply("ok"));
        await assert.rejects(rewrite("hello", { ...cfg, apiKey: "" }, fn), /No OpenRouter API key set/);
        assert.equal(calls.length, 0);
    });

    it("includes status and OpenRouter's message on HTTP errors", async () => {
        const { fn } = fakeFetch(401, { error: { message: "bad key" } });
        await assert.rejects(rewrite("hello", cfg, fn), /OpenRouter 401: bad key/);
    });

    it("rejects a 200 response without choices", async () => {
        const { fn } = fakeFetch(200, { error: { message: "x" } });
        await assert.rejects(rewrite("hello", cfg, fn), /empty reply/);
    });

    it("rejects a whitespace-only reply", async () => {
        const { fn } = fakeFetch(200, reply("   "));
        await assert.rejects(rewrite("hello", cfg, fn), /empty reply/);
    });
});
