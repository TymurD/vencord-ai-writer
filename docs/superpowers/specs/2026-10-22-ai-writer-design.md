# AI Writer — Vesktop/Vencord plugin design

## Goal
A chat-bar toggle in Vesktop with two modes. **Off** (default): Discord behaves normally.
**AI**: when a message is sent, its text is rewritten by an OpenRouter model using a
user-editable prompt, and the AI's reply is sent instead.

## Layout
- `aiWriter/index.tsx` — plugin definition: settings, chat-bar button, send/edit listeners, OpenRouter call.
- `aiWriter/SettingsModal.tsx` — the settings window.
- `Vencord/` — Vencord source checkout (cloned here). `Vencord/src/userplugins/aiWriter` is a symlink to `../../../aiWriter`.
- Built with `pnpm build`; Vesktop's "Vencord Location" setting points at `Vencord/dist`.

## Chat-bar button
- Sparkle icon, registered via the plugin's `chatBarButton`.
- **Left-click**: toggles Off/AI. AI mode shows a highlighted icon; tooltip reads "AI mode: ON" / "AI mode: OFF".
- **Right-click**: opens the settings window.
- Mode is in-memory only and resets to Off on every launch.

## Settings window
Discord-styled modal (Vencord `ModalRoot`) with:
- **Prompt** — multi-line text; used as the system message.
- **Model** — text, OpenRouter model id (default `anthropic/claude-sonnet-5-5`).
- **API key** — masked text input.
- **Also rewrite edits** — switch, default off.
- Save / Cancel. Values persist via `definePluginSettings` (also visible under Settings → Plugins → AiWriter).

## Send flow
Uses `addMessagePreSendListener` (async, may return `{ cancel: true }`), so Enter, replies and attachments go through Discord's normal path.

When AI mode is on and the message text is non-empty and does not start with `/`:
1. Show a "Rewriting…" toast.
2. `POST https://openrouter.ai/api/v1/chat/completions` with `{ model, messages: [{role: "system", content: prompt}, {role: "user", content: text}] }`, `Authorization: Bearer <key>`.
3. Replace `messageObj.content` with the trimmed reply; the send proceeds.

Otherwise the message passes through untouched.

## Edit flow
`addMessagePreEditListener` applies the same rewrite, but only when AI mode is on **and** "Also rewrite edits" is enabled. Otherwise edits are untouched.

## Errors
Missing API key, network/HTTP error, or empty reply → return `{ cancel: true }` and show a failure toast with the reason. The user's text stays in the box.

## Testing
Manual, after `pnpm build` and pointing Vesktop at `Vencord/dist`:
- Off mode: messages and edits sent unchanged.
- AI mode: message is replaced with the model's rewrite (test in a DM to self / test channel).
- Edits: unchanged with the switch off; rewritten with it on.
- Bad API key: send cancelled, error toast, text preserved.
- Right-click opens the window; saved values survive a restart.

No automated tests: the plugin is glue over Discord internals that can't be exercised outside the client.
