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
const PLACEHOLDER_HINT = "The message may contain placeholders like ⟦0⟧ that stand for mentions or emoji. Keep every placeholder exactly as written.";

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

export async function rewrite(text: string, cfg: RewriteConfig, fetchFn: typeof fetch = fetch): Promise<string> {
    if (!cfg.apiKey) throw new Error("No OpenRouter API key set");

    const { masked, tokens } = maskTokens(text);
    const prompt = tokens.length ? `${cfg.prompt}\n\n${PLACEHOLDER_HINT}` : cfg.prompt;

    let res: Response;
    try {
        res = await fetchFn(OPENROUTER_URL, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${cfg.apiKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: cfg.model,
                messages: [
                    { role: "system", content: prompt },
                    { role: "user", content: masked }
                ]
            }),
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

    const result = unmaskTokens(content.trim(), tokens);
    const maxLength = cfg.maxLength ?? 2000;
    if (result.length > maxLength) {
        throw new Error(`AI reply too long (${result.length}/${maxLength})`);
    }

    return result;
}
