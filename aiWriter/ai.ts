const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const TIMEOUT_MS = 30_000;

export type RewriteConfig = {
    apiKey: string;
    model: string;
    prompt: string;
    /** Discord's message length limit: 2000, or 4000 with Nitro. */
    maxLength?: number;
};

export function shouldRewrite(text: string): boolean {
    return text.trim() !== "" && !text.startsWith("/");
}

export async function rewrite(text: string, cfg: RewriteConfig, fetchFn: typeof fetch = fetch): Promise<string> {
    if (!cfg.apiKey) throw new Error("No OpenRouter API key set");

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
                    { role: "system", content: cfg.prompt },
                    { role: "user", content: text }
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
    if (typeof content !== "string" || !content.trim()) {
        throw new Error("AI returned an empty reply");
    }

    const result = content.trim();
    const maxLength = cfg.maxLength ?? 2000;
    if (result.length > maxLength) {
        throw new Error(`AI reply too long (${result.length}/${maxLength})`);
    }

    return result;
}
