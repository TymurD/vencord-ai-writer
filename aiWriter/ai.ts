const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export type RewriteConfig = {
    apiKey: string;
    model: string;
    prompt: string;
};

export function shouldRewrite(text: string): boolean {
    return text.trim() !== "" && !text.startsWith("/");
}

export async function rewrite(text: string, cfg: RewriteConfig, fetchFn: typeof fetch = fetch): Promise<string> {
    if (!cfg.apiKey) throw new Error("No OpenRouter API key set");

    const res = await fetchFn(OPENROUTER_URL, {
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
        })
    });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
        throw new Error(`OpenRouter ${res.status}: ${data?.error?.message ?? res.statusText}`);
    }

    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
        throw new Error("AI returned an empty reply");
    }

    return content.trim();
}
