import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

export const settings = definePluginSettings({
    prompt: {
        type: OptionType.STRING,
        description: "System prompt sent to the model along with your message",
        default: "Rewrite the user's message to be clear and well-written. Reply with only the rewritten message."
    },
    model: {
        type: OptionType.STRING,
        description: "OpenRouter model id",
        default: "anthropic/claude-sonnet-5-5"
    },
    apiKey: {
        type: OptionType.STRING,
        description: "OpenRouter API key",
        default: ""
    },
    rewriteEdits: {
        type: OptionType.BOOLEAN,
        description: "Also rewrite message edits while AI mode is on",
        default: false
    }
});
