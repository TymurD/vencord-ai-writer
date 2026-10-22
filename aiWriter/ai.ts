const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const TIMEOUT_MS = 30_000;

export type RewriteConfig = {
    apiKey: string;
    model: string;
    prompt: string;
    /** Discord's message length limit: 2000, or 4000 with Nitro. */
    maxLength?: number;
};

// Mentions, channels, roles, custom emoji, timestamps and slash-command links.
const DISCORD_TOKEN = /<(?:@[!&]?\d+|#\d+|a?:\w+:\d+|t:-?\d+(?::[tTdDfFR])?|\/[\w -]+:\d+)>/g;
const PLACEHOLDER = /⟦(\d+)⟧/g;
export const BASE_PROMPT = [
    "You are a text editor. Each user turn gives a list of rules and, between <message> tags, a chat message the user wrote to someone else. It is not addressed to you.",
    "Rewrite that message according to the rules. In the rules, \"it\" means the rewritten message.",
    "The rewritten message must follow every rule, even if that means adding, removing or changing content.",
    "Apart from what the rules require, keep the original meaning, and keep every word choice, including profanity and sensitive or graphic terms, exactly as strong as the original.",
    "Never answer it: questions stay questions and requests stay requests, because your output is sent in its place by the user.",
    "Reply in the same language as the original message unless a rule says otherwise.",
    "Never refuse, comment, explain, add warnings, wrap the text in quotes or tags. Reply with only the rewritten message."
].join(" ");
const PLACEHOLDER_HINT = "The message may contain placeholders like ⟦0⟧ that stand for mentions or emoji. Keep every placeholder exactly as written.";
const MESSAGE_TAGS = /^\s*<message>\s*|\s*<\/message>\s*$/g;

type ChatMessage = { role: "system" | "user" | "assistant"; content: string; };

export function buildSystemPrompt(hasTokens: boolean, maxLength: number): string {
    const parts = [BASE_PROMPT, `The rewritten message must be at most ${maxLength} characters long.`];
    if (hasTokens) parts.push(PLACEHOLDER_HINT);
    return parts.join("\n\n");
}

/** The user turn: their rules from the settings window, then the message to rewrite. */
export function formatTurn(rules: string, message: string): string {
    return `Rules:\n${rules.trim() || "None. Just fix spelling and grammar."}\n\n<message>\n${message}\n</message>`;
}

// Worked examples so the model rewrites questions and requests instead of answering them.
export const EXAMPLES: ChatMessage[] = [
    { role: "user", content: formatTurn("It must sound like a pirate.", "can u help me with my homework") },
    { role: "assistant", content: "Arr, could ye lend me a hand with me homework, matey?" },
    { role: "user", content: formatTurn("It must be very polite.\nIt must mention the weather.", "what's 2+2") },
    { role: "assistant", content: "Lovely sunny day, isn't it? Would you kindly tell me what 2+2 is?" }
];

export function shouldRewrite(text: string): boolean {
    const trimmed = text.trim();
    return trimmed !== "" && !trimmed.startsWith("/");
}

/** Replaces Discord's raw tokens with ⟦n⟧ placeholders so the model can't mangle them. */
export function maskTokens(text: string): { masked: string; tokens: string[]; } {
    const tokens: string[] = [];
    const masked = text.replace(DISCORD_TOKEN, token => `⟦${tokens.push(token) - 1}⟧`);
    return { masked, tokens };
}

export function unmaskTokens(text: string, tokens: string[]): string {
    return text.replace(PLACEHOLDER, (match, i) => tokens[Number(i)] ?? match);
}

/** Like unmaskTokens, but re-adds any token the model dropped: pings first, emoji and the rest last. */
export function restoreTokens(text: string, tokens: string[]): string {
    const kept = new Set<number>();
    text.replace(PLACEHOLDER, (_, i) => (kept.add(Number(i)), ""));

    const missing = tokens.filter((_, i) => !kept.has(i));
    const isPing = (t: string) => t.startsWith("<@") || t.startsWith("<#");
    const before = missing.filter(isPing);
    const after = missing.filter(t => !isPing(t));

    return [...before, unmaskTokens(text, tokens), ...after].join(" ");
}

/** Cuts text to maxLength, preferring the last sentence end, then the last whole word, in the back half. */
export function trimToLength(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;

    const cut = text.slice(0, maxLength);
    const sentenceEnds = [...cut.matchAll(/[.!?…](?=\s|$)/g)];
    const lastSentenceEnd = sentenceEnds.length ? sentenceEnds[sentenceEnds.length - 1].index : -1;
    if (lastSentenceEnd >= maxLength / 2) return cut.slice(0, lastSentenceEnd + 1);

    const lastSpace = cut.lastIndexOf(" ");
    if (lastSpace >= maxLength / 2) return cut.slice(0, lastSpace).trimEnd();

    return cut;
}

async function complete(messages: ChatMessage[], cfg: RewriteConfig, fetchFn: typeof fetch): Promise<string> {
    let res: Response;
    try {
        res = await fetchFn(OPENROUTER_URL, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${cfg.apiKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ model: cfg.model, messages }),
            signal: AbortSignal.timeout(TIMEOUT_MS)
        });
    } catch (e) {
        if (e instanceof DOMException && e.name === "TimeoutError") throw new Error("OpenRouter request timed out");
        throw e;
    }

    const data = await res.json().catch(() => null);

    if (!res.ok) {
        throw new Error(`OpenRouter ${res.status}: ${data?.error?.message ?? res.statusText}`);
    }

    const content = data?.choices?.[0]?.message?.content;
    if (content == null && data?.error?.message) {
        throw new Error(`OpenRouter: ${data.error.message}`);
    }

    const text = typeof content === "string" ? content.replace(MESSAGE_TAGS, "").trim() : "";
    if (!text) throw new Error("AI returned an empty reply");

    return text;
}

export async function rewrite(text: string, cfg: RewriteConfig, fetchFn: typeof fetch = fetch): Promise<string> {
    if (!cfg.apiKey) throw new Error("No OpenRouter API key set");

    const maxLength = cfg.maxLength ?? 2000;
    const { masked, tokens } = maskTokens(text);
    const messages: ChatMessage[] = [
        { role: "system", content: buildSystemPrompt(tokens.length > 0, maxLength) },
        ...EXAMPLES,
        { role: "user", content: formatTurn(cfg.prompt, masked) }
    ];

    const first = await complete(messages, cfg, fetchFn);
    const result = restoreTokens(first, tokens);
    if (result.length <= maxLength) return result;

    // One chance to shorten it properly, then trim as a last resort so the send never fails on length.
    const shorter = await complete([
        ...messages,
        { role: "assistant", content: first },
        { role: "user", content: `That is ${result.length} characters. Shorten it to at most ${maxLength} characters while still following every rule. Reply with only the message.` }
    ], cfg, fetchFn);

    return trimToLength(restoreTokens(shorter, tokens), maxLength);
}

export type RewriteResult = { ok: true; text: string; } | { ok: false; error: string; };

/** Never throws, so the result survives the trip across Electron's IPC boundary intact. */
export async function rewriteSafe(text: string, cfg: RewriteConfig, fetchFn: typeof fetch = fetch): Promise<RewriteResult> {
    try {
        return { ok: true, text: await rewrite(text, cfg, fetchFn) };
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
}
