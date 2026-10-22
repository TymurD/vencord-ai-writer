import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { maskTokens, rewrite, rewriteSafe, shouldRewrite, unmaskTokens } from "../aiWriter/ai.ts";

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
    it("skips slash commands after leading whitespace", () => assert.equal(shouldRewrite("  /shrug"), false));
});

describe("maskTokens", () => {
    const text = "hi <@123> <@!4> <@&5> <#9> <:wave:456> <a:dance:7> <t:1700000000:R> </ping:8>";

    it("replaces every Discord token with a numbered placeholder", () => {
        const { masked, tokens } = maskTokens(text);
        assert.equal(masked, "hi ⟦0⟧ ⟦1⟧ ⟦2⟧ ⟦3⟧ ⟦4⟧ ⟦5⟧ ⟦6⟧ ⟦7⟧");
        assert.deepEqual(tokens, ["<@123>", "<@!4>", "<@&5>", "<#9>", "<:wave:456>", "<a:dance:7>", "<t:1700000000:R>", "</ping:8>"]);
    });

    it("leaves ordinary angle brackets alone", () => {
        assert.deepEqual(maskTokens("a <b> c <https://x.y>"), { masked: "a <b> c <https://x.y>", tokens: [] });
    });

    it("round-trips through unmaskTokens, even when reordered", () => {
        const { tokens } = maskTokens(text);
        assert.equal(unmaskTokens("⟦4⟧ thanks ⟦0⟧", tokens), "<:wave:456> thanks <@123>");
    });

    it("keeps unknown placeholders as-is", () => {
        assert.equal(unmaskTokens("x ⟦9⟧", ["<@1>"]), "x ⟦9⟧");
    });
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
        const { fn } = fakeFetch(200, {});
        await assert.rejects(rewrite("hello", cfg, fn), /empty reply/);
    });

    it("surfaces OpenRouter's error message on a 200 response", async () => {
        const { fn } = fakeFetch(200, { error: { message: "upstream moderation" } });
        await assert.rejects(rewrite("hello", cfg, fn), /OpenRouter: upstream moderation/);
    });

    it("sends mentions as placeholders and restores them in the reply", async () => {
        const { fn, calls } = fakeFetch(200, reply("Hey ⟦0⟧, look ⟦1⟧"));
        const result = await rewrite("yo <@123> see <:wave:456>", cfg, fn);

        assert.equal(result, "Hey <@123>, look <:wave:456>");
        const [system, user] = JSON.parse(calls[0].init.body as string).messages;
        assert.equal(user.content, "yo ⟦0⟧ see ⟦1⟧");
        assert.ok(system.content.startsWith("p\n\n"));
        assert.match(system.content, /Keep every placeholder exactly/);
    });

    it("checks the length limit after restoring tokens", async () => {
        const { fn } = fakeFetch(200, reply("a".repeat(1995) + " ⟦0⟧"));
        await assert.rejects(rewrite("<@123456789012345678>", cfg, fn), /too long \(2017\/2000\)/);
    });

    it("rejects a reply longer than the message limit", async () => {
        const { fn } = fakeFetch(200, reply("a".repeat(2001)));
        await assert.rejects(rewrite("hello", cfg, fn), /too long \(2001\/2000\)/);
    });

    it("respects a custom message limit", async () => {
        const { fn } = fakeFetch(200, reply("a".repeat(2001)));
        assert.equal((await rewrite("hello", { ...cfg, maxLength: 4000 }, fn)).length, 2001);
    });

    it("passes an abort signal so the request can time out", async () => {
        const { fn, calls } = fakeFetch(200, reply("ok"));
        await rewrite("hello", cfg, fn);
        assert.ok(calls[0].init.signal instanceof AbortSignal);
    });

    it("reports a timeout clearly", async () => {
        const fn = (async () => {
            throw new DOMException("timed out", "TimeoutError");
        }) as unknown as typeof fetch;
        await assert.rejects(rewrite("hello", cfg, fn), /OpenRouter request timed out/);
    });

    it("rejects a whitespace-only reply", async () => {
        const { fn } = fakeFetch(200, reply("   "));
        await assert.rejects(rewrite("hello", cfg, fn), /empty reply/);
    });
});

describe("rewriteSafe", () => {
    it("wraps a successful rewrite", async () => {
        const { fn } = fakeFetch(200, reply("Hi"));
        assert.deepEqual(await rewriteSafe("hello", cfg, fn), { ok: true, text: "Hi" });
    });

    it("returns the error message instead of throwing", async () => {
        const { fn } = fakeFetch(401, { error: { message: "bad key" } });
        assert.deepEqual(await rewriteSafe("hello", cfg, fn), { ok: false, error: "OpenRouter 401: bad key" });
    });

    it("reports network failures readably", async () => {
        const fn = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
        assert.deepEqual(await rewriteSafe("hello", cfg, fn), { ok: false, error: "fetch failed" });
    });
});
