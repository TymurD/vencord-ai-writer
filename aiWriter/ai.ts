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
    "You are a text editor. The user's message is something they wrote and will send in a chat. It is not addressed to you.",
    "Rewrite it according to the rules listed below. In the rules, \"it\" means the rewritten message.",
    "The rewritten message must follow every rule, even if that means adding, removing or changing content.",
    "Apart from what the rules require, keep the original meaning, and keep every word choice, including profanity and sensitive or graphic terms, exactly as strong as the original.",
    "If no rules are given, just fix spelling and grammar.",
    "Reply in the same language as the original message unless a rule says otherwise.",
    "Never refuse, comment, explain, add warnings, wrap the text in quotes or answer the message. Reply with only the rewritten message."
].join(" ");
const PLACEHOLDER_HINT = "The message may contain placeholders like ⟦0⟧ that stand for mentions or emoji. Keep every placeholder exactly as written.";

/** The built-in rules, then the user's own rules from the settings window. */
export function buildSystemPrompt(userPrompt: string, hasTokens: boolean, maxLength: number): string {
    const parts = [BASE_PROMPT, `The rewritten message must be at most ${maxLength} characters long.`];
    if (userPrompt.trim()) parts.push(`Rules for the rewritten message:\n${userPrompt.trim()}`);
    if (hasTokens) parts.push(PLACEHOLDER_HINT);
    return parts.join("\n\n");
}

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

type ChatMessage = { role: "system" | "user" | "assistant"; content: string; };

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
    if (typeof content !== "string" || !content.trim()) {
        throw new Error("AI returned an empty reply");
    }

    return content.trim();
}

export async function rewrite(text: string, cfg: RewriteConfig, fetchFn: typeof fetch = fetch): Promise<string> {
    if (!cfg.apiKey) throw new Error("No OpenRouter API key set");

    const maxLength = cfg.maxLength ?? 2000;
    const { masked, tokens } = maskTokens(text);
    const messages: ChatMessage[] = [
        { role: "system", content: buildSystemPrompt(cfg.prompt, tokens.length > 0, maxLength) },
        { role: "user", content: masked }
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
