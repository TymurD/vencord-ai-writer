import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BASE_PROMPT, buildSystemPrompt, EXAMPLES, formatTurn, maskTokens, rewrite, rewriteSafe, shouldRewrite, trimToLength, unmaskTokens } from "../aiWriter/ai.ts";

const cfg = { apiKey: "k", model: "m", prompt: "p" };

/** Pass an array of bodies to answer successive calls; the last one repeats. */
function fakeFetch(status: number, body: unknown) {
    const bodies = Array.isArray(body) ? body : [body];
    const calls: { url: string; init: RequestInit; }[] = [];
    const fn = (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        const next = bodies[Math.min(calls.length - 1, bodies.length - 1)];
        return new Response(JSON.stringify(next), { status, statusText: "Status" });
    }) as unknown as typeof fetch;
    return { fn, calls };
}

const messagesOf = (call: { init: RequestInit; }) => JSON.parse(call.init.body as string).messages;

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

describe("buildSystemPrompt", () => {
    it("always tells the model to reply with only the message, in the same language", () => {
        assert.match(BASE_PROMPT, /only the rewritten message/);
        assert.match(BASE_PROMPT, /same language/);
    });

    it("tells the model the user's rules describe the final message and must all be followed", () => {
        assert.match(BASE_PROMPT, /"it" means the rewritten message/);
        assert.match(BASE_PROMPT, /must follow every rule/);
    });

    it("tells the model never to answer, keeping questions and requests as they are", () => {
        assert.match(BASE_PROMPT, /Never answer it/);
        assert.match(BASE_PROMPT, /questions stay questions and requests stay requests/);
    });

    it("adds the length limit after the built-in rules", () => {
        assert.equal(buildSystemPrompt(false, 4000), `${BASE_PROMPT}\n\nThe rewritten message must be at most 4000 characters long.`);
    });

    it("adds the placeholder hint only when the message has tokens", () => {
        assert.match(buildSystemPrompt(true, 2000), /Keep every placeholder exactly as written\.$/);
        assert.doesNotMatch(buildSystemPrompt(false, 2000), /placeholder/);
    });
});

describe("formatTurn", () => {
    it("puts the user's rules first and the message in <message> tags", () => {
        assert.equal(
            formatTurn("It must contain 5 names of pizzas", "hi"),
            "Rules:\nIt must contain 5 names of pizzas\n\n<message>\nhi\n</message>"
        );
    });

    it("says to just fix spelling and grammar when there are no rules", () => {
        assert.equal(formatTurn("  \n", "hi"), "Rules:\nNone. Just fix spelling and grammar.\n\n<message>\nhi\n</message>");
    });
});

describe("EXAMPLES", () => {
    it("alternates example user turns and rewritten replies", () => {
        assert.ok(EXAMPLES.length >= 4);
        EXAMPLES.forEach((m, i) => assert.equal(m.role, i % 2 ? "assistant" : "user"));
    });

    it("shows a question and a request kept as a question and a request, not answered", () => {
        const replies = EXAMPLES.filter(m => m.role === "assistant").map(m => m.content);
        assert.ok(replies.every(r => r.trim().endsWith("?")));
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
                { role: "system", content: buildSystemPrompt(false, 2000) },
                ...EXAMPLES,
                { role: "user", content: formatTurn("p", "hello") }
            ]
        });
    });

    it("strips <message> tags the model echoes back", async () => {
        const { fn } = fakeFetch(200, reply("<message>\nHi there\n</message>"));
        assert.equal(await rewrite("hello", cfg, fn), "Hi there");
    });

    it("treats a reply that is only empty tags as empty", async () => {
        const { fn } = fakeFetch(200, reply("<message>\n</message>"));
        await assert.rejects(rewrite("hello", cfg, fn), /empty reply/);
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
        const msgs = messagesOf(calls[0]);
        assert.equal(msgs[0].content, buildSystemPrompt(true, 2000));
        assert.equal(msgs[msgs.length - 1].content, formatTurn("p", "yo ⟦0⟧ see ⟦1⟧"));
    });

    it("puts back a mention the model dropped at the start", async () => {
        const { fn } = fakeFetch(200, reply("Hark, thou wretched creature"));
        assert.equal(await rewrite("<@466163485227876352>", cfg, fn), "<@466163485227876352> Hark, thou wretched creature");
    });

    it("puts back dropped mentions first and dropped emoji last, keeping the ones the model kept in place", async () => {
        const { fn } = fakeFetch(200, reply("look ⟦1⟧ here"));
        assert.equal(
            await rewrite("<@1> <#2> hi <:wave:3> <@&4>", cfg, fn),
            "<@1> <@&4> look <#2> here <:wave:3>"
        );
    });

    it("asks the model once to shorten an over-long reply", async () => {
        const long = "a".repeat(2001);
        const { fn, calls } = fakeFetch(200, [reply(long), reply("short")]);
        assert.equal(await rewrite("hello", cfg, fn), "short");

        assert.equal(calls.length, 2);
        const first = messagesOf(calls[0]);
        const msgs = messagesOf(calls[1]);
        assert.deepEqual(msgs.slice(0, first.length + 1), [...first, { role: "assistant", content: long }]);
        assert.equal(msgs[first.length + 1].role, "user");
        assert.match(msgs[first.length + 1].content, /2001 characters.*at most 2000/);
    });

    it("counts restored mentions toward the limit", async () => {
        const { fn, calls } = fakeFetch(200, [reply("a".repeat(1995) + " ⟦0⟧"), reply("ok ⟦0⟧")]);
        assert.equal(await rewrite("<@123456789012345678>", cfg, fn), "ok <@123456789012345678>");
        assert.equal(calls.length, 2);
    });

    it("trims at a sentence end when the shortened reply is still too long", async () => {
        const { fn, calls } = fakeFetch(200, reply("This is a sentence. ".repeat(150)));
        const result = await rewrite("hello", cfg, fn);
        assert.equal(calls.length, 2);
        assert.ok(result.length <= 2000);
        assert.ok(result.endsWith("sentence."));
    });

    it("keeps a dropped ping when trimming", async () => {
        const { fn } = fakeFetch(200, reply("Blah blah. ".repeat(300)));
        const result = await rewrite("<@123456789012345678>", cfg, fn);
        assert.ok(result.startsWith("<@123456789012345678> Blah"));
        assert.ok(result.length <= 2000);
    });

    it("respects a custom message limit", async () => {
        const { fn, calls } = fakeFetch(200, reply("a".repeat(2001)));
        assert.equal((await rewrite("hello", { ...cfg, maxLength: 4000 }, fn)).length, 2001);
        assert.equal(calls.length, 1);
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

describe("trimToLength", () => {
    it("leaves text within the limit untouched", () => {
        assert.equal(trimToLength("Hi there.", 20), "Hi there.");
    });

    it("cuts at the last sentence end that fits", () => {
        assert.equal(trimToLength("One two three. Four five six! Seven eight", 33), "One two three. Four five six!");
    });

    it("falls back to the last whole word when no sentence end is close enough", () => {
        assert.equal(trimToLength("Hi. alpha beta gamma delta epsilon", 25), "Hi. alpha beta gamma");
    });

    it("hard-cuts a single huge word", () => {
        assert.equal(trimToLength("x".repeat(50), 10), "x".repeat(10));
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
