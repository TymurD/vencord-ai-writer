import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import definePlugin, { IconComponent } from "@utils/types";
import { showToast, useEffect, UserStore, useState } from "@webpack/common";

import { rewrite, shouldRewrite } from "./ai";
import { settings } from "./settings";
import { openSettingsModal } from "./SettingsModal";

// In-memory only, so AI mode is always off after a restart.
let aiEnabled = false;
const modeListeners = new Set<(enabled: boolean) => void>();

function setAiEnabled(value: boolean) {
    aiEnabled = value;
    modeListeners.forEach(l => l(value));
}

const SparkleIcon: IconComponent = ({ height = 20, width = 20, className }) => (
    <svg width={width} height={height} viewBox="0 0 24 24" className={className}>
        <path
            fill="currentColor"
            d="M12 2l1.9 5.6L19.5 9.5l-5.6 1.9L12 17l-1.9-5.6L4.5 9.5l5.6-1.9L12 2zm7 12l.95 2.55L22.5 17.5l-2.55.95L19 21l-.95-2.55-2.55-.95 2.55-.95L19 14zM5 15l.7 1.8 1.8.7-1.8.7L5 20l-.7-1.8-1.8-.7 1.8-.7L5 15z"
        />
    </svg>
);

const AiToggleButton: ChatBarButtonFactory = ({ isAnyChat }) => {
    const [enabled, setEnabled] = useState(aiEnabled);

    useEffect(() => {
        modeListeners.add(setEnabled);
        return () => void modeListeners.delete(setEnabled);
    }, []);

    // Rewrites apply to every composer (incl. threads), so show the state in all of them.
    if (!isAnyChat) return null;

    return (
        <ChatBarButton
            tooltip={`AI mode: ${enabled ? "ON" : "OFF"} (right-click for settings)`}
            onClick={() => setAiEnabled(!aiEnabled)}
            onContextMenu={e => {
                e.preventDefault();
                openSettingsModal();
            }}
        >
            <span style={{ color: enabled ? "var(--brand-500)" : undefined, display: "flex" }}>
                <SparkleIcon />
            </span>
        </ChatBarButton>
    );
};

async function maybeRewrite(msg: { content: string; }) {
    if (!aiEnabled || !shouldRewrite(msg.content)) return;

    showToast({ text: "Rewriting…" });
    try {
        const { apiKey, model, prompt } = settings.store;
        // premiumType 2 = full Nitro, which raises Discord's limit to 4000
        const maxLength = UserStore.getCurrentUser()?.premiumType === 2 ? 4000 : 2000;
        msg.content = await rewrite(msg.content, { apiKey, model, prompt, maxLength });
    } catch (e) {
        showToast({ text: `AI Writer: ${e instanceof Error ? e.message : String(e)}`, variant: "critical" });
        return { cancel: true };
    }
}

export default definePlugin({
    name: "AiWriter",
    description: "Toggle in the chat bar that rewrites your messages through OpenRouter before sending",
    authors: [{ name: "tymurd", id: 0n }],
    settings,

    chatBarButton: {
        icon: SparkleIcon,
        render: AiToggleButton
    },

    onBeforeMessageSend: (_, msg) => maybeRewrite(msg),
    onBeforeMessageEdit: (_, __, msg) => settings.store.rewriteEdits ? maybeRewrite(msg) : undefined
});
