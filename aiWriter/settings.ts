import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

export const settings = definePluginSettings({
    prompt: {
        type: OptionType.STRING,
        description: "Rules your rewritten message must follow (\"it\" = your message)",
        default: "Fix spelling and grammar and make it sound natural."
    },
    model: {
        type: OptionType.STRING,
        description: "OpenRouter model id",
        default: "cognitivecomputations/dolphin-mistral-24b-venice-edition"
    },
    apiKey: {
        type: OptionType.STRING,
        description: "OpenRouter API key",
        default: "",
        // Edited in the masked field of the right-click window, not shown in plain text here.
        hidden: true
    },
    rewriteEdits: {
        type: OptionType.BOOLEAN,
        description: "Also rewrite message edits while AI mode is on",
        default: false
    }
});
