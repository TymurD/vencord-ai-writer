# AI Writer for Vesktop

A [Vencord](https://github.com/Vendicated/Vencord) userplugin for [Vesktop](https://github.com/Vencord/Vesktop) that adds an **AI mode** toggle to Discord's message box. When it's on, every message you send is rewritten by an AI model through [OpenRouter](https://openrouter.ai), following rules you write yourself, and the rewrite is sent instead of what you typed.

> **Heads-up:** client mods are against Discord's Terms of Service. Vencord is widely used, but use it at your own risk.

## Features

- **One-click toggle** in the message box (sparkle icon). Left-click switches AI mode on/off; it is highlighted while on and always starts **off** when Discord launches.
- **Settings window** on right-click: your rules, the model, your API key, and whether edits are rewritten too.
- **Rules, not prompts.** You write rules for the final message ("It must sound casual."), and the built-in instructions take care of "reply with only the message", keeping your language, and not softening your wording.
- **Any OpenRouter model**: swap models by pasting a model id.
- **Mentions and emoji survive.** Pings, role/channel mentions, custom emoji and timestamps are protected from the model, and any ping the model drops is put back so it still notifies.
- **Safe failures.** If anything goes wrong (no key, bad model, rate limit, timeout, reply over Discord's length limit), the send is cancelled, you get a red toast saying why, and your text stays in the box.
- **Edits are optional.** Message edits are left alone unless you enable "Also rewrite edits".
- Slash commands and empty/attachment-only messages are never touched.

## Requirements

| | Version | Notes |
|---|---|---|
| [Vesktop](https://github.com/Vencord/Vesktop) | any recent | the Discord client this plugs into |
| [Node.js](https://nodejs.org) | **22 or newer** | needed to build Vencord |
| [Git](https://git-scm.com) | any | to clone this repo and Vencord |
| [OpenRouter](https://openrouter.ai) account | | with credits and an API key from [openrouter.ai/keys](https://openrouter.ai/keys) |

You don't need to install pnpm globally: the steps below run Vencord's pinned version through `npx`.

## How it fits together

Vesktop can't load single-file plugins. Custom plugins are built into Vencord from source, and Vesktop is then pointed at your own build. The folder layout ends up like this:

```
vencord-ai-writer/
├── aiWriter/          ← the plugin (this repo)
├── tests/             ← unit tests
└── Vencord/           ← Vencord source, cloned by you (git-ignored)
    └── src/userplugins/aiWriter → link to ../../../aiWriter
```

`Vencord/` must sit next to `aiWriter/`: the plugin's `tsconfig.json` points at `../Vencord/tsconfig.json` so the build can find Vencord's imports.

## Installation on Linux

```bash
# 1. Clone this repo and Vencord next to the plugin
git clone https://github.com/TymurD/vencord-ai-writer.git
cd vencord-ai-writer
git clone --depth 1 https://github.com/Vendicated/Vencord.git

# 2. Link the plugin into Vencord's userplugins folder
mkdir -p Vencord/src/userplugins
ln -s ../../../aiWriter Vencord/src/userplugins/aiWriter

# 3. Install Vencord's dependencies and build
cd Vencord
npx pnpm@11.9.0 install --frozen-lockfile
npx pnpm@11.9.0 build
```

Then [point Vesktop at your build](#point-vesktop-at-your-build).

## Installation on Windows

Install the tools first if you don't have them (PowerShell):

```powershell
winget install OpenJS.NodeJS.LTS
winget install Git.Git
```

Close and reopen PowerShell so `node` and `git` are on your PATH, then:

```powershell
# 1. Clone this repo and Vencord next to the plugin
git clone https://github.com/TymurD/vencord-ai-writer.git
cd vencord-ai-writer
git clone --depth 1 https://github.com/Vendicated/Vencord.git

# 2. Link the plugin into Vencord's userplugins folder (a junction needs no admin rights)
New-Item -ItemType Directory -Force Vencord\src\userplugins | Out-Null
New-Item -ItemType Junction -Path Vencord\src\userplugins\aiWriter -Target (Resolve-Path aiWriter)

# 3. Install Vencord's dependencies and build
cd Vencord
npx pnpm@11.9.0 install --frozen-lockfile
npx pnpm@11.9.0 build
```

If PowerShell refuses to run `npx` because of its execution policy, run the same commands in **Command Prompt** instead, or allow local scripts once with `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

## Point Vesktop at your build

1. Open Vesktop → **Settings** → **Vesktop Settings** → **Vencord Location**, and choose the `Vencord/dist` folder inside your clone. For example:
   - Linux: `/home/you/vencord-ai-writer/Vencord/dist`
   - Windows: `C:\Users\you\vencord-ai-writer\Vencord\dist`
2. **Fully quit Vesktop and start it again.** Closing the window isn't enough if "minimize to tray" is on: right-click the tray icon → **Quit**.
3. Go to **Settings** → **Plugins**, search for **AiWriter**, enable it, and restart Vesktop once more if it asks.

A sparkle icon now shows in the message box.

## Configuration

Right-click the sparkle icon to open the settings window:

| Field | What it does |
|---|---|
| **Rules** | Rules the rewritten message must follow. "It" means your message. Leave it empty to just fix spelling and grammar. |
| **Model** | An OpenRouter model id, e.g. `x-ai/grok-4.3`. Browse [openrouter.ai/models](https://openrouter.ai/models). |
| **OpenRouter API key** | Your `sk-or-…` key. Shown masked in this window only. |
| **Also rewrite edits** | Off by default. When on, editing a message while AI mode is on rewrites the edit too. |

Changes apply from your next message; no restart needed.

### Default config

This is the setup I use day to day. Fill in the window like this:

- **Rules**
  ```
  It must fix my spelling and grammar.
  It must sound casual and natural.
  It must stay in the same language I wrote in.
  ```
- **Model:** `x-ai/grok-4.3`
- **OpenRouter API key:** `sk-or-v1-…` (your own key)
- **Also rewrite edits:** off

Vencord saves these in its settings file: `~/.config/vesktop/settings/settings.json` on Linux, `%APPDATA%\vesktop\settings\settings.json` on Windows. The plugin's section looks like this:

```json
"AiWriter": {
    "enabled": true,
    "prompt": "It must fix my spelling and grammar.\nIt must sound casual and natural.\nIt must stay in the same language I wrote in.",
    "model": "x-ai/grok-4.3",
    "apiKey": "sk-or-v1-...",
    "rewriteEdits": false
}
```

The API key is stored there in plain text, like every Vencord setting. Don't share that file.

### Writing rules

Write one rule per line, about the final message:

```
It must sound like a pirate.
It must contain 5 names of pizzas.
It must be in English.
It must be under two sentences.
```

The built-in instructions already tell the model to reply with only the rewritten message, keep your language unless a rule says otherwise, and keep your wording as strong as you wrote it. You don't need to repeat those.

Rules that ask for long output can push a reply past Discord's limit (2000 characters, or 4000 with Nitro). When that happens the send is cancelled with an error, so add a length rule if you write long-form rules.

### Choosing a model

| Model id | Good for |
|---|---|
| `x-ai/grok-4.3` | **Default.** Smart, good in many languages, follows rules well and rarely refuses blunt wording. |
| `mistralai/mistral-large-2512` | Cheaper, strong in European languages, lightly filtered. Occasionally rate-limited (HTTP 429). |
| `cognitivecomputations/dolphin-mistral-24b-venice-edition` | Cheapest and almost never refuses, but weaker at following rules and sometimes answers your message instead of rewriting it. |

Strictly safety-tuned models (e.g. the `openai/gpt-oss-*` family) may refuse to rewrite some messages.

## Usage

1. Type your message as usual.
2. Left-click the sparkle so it's highlighted (AI mode **on**).
3. Press Enter. A "Rewriting…" toast appears, and the rewritten message is sent a moment later.
4. Click the sparkle again to go back to normal sending.

What is never rewritten:
- messages while AI mode is off
- empty or attachment-only messages
- messages starting with `/`
- edits, unless "Also rewrite edits" is on

## Troubleshooting

| Toast / symptom | Cause and fix |
|---|---|
| `No OpenRouter API key set` | Right-click the sparkle and paste your key. |
| `OpenRouter 401: …` | The key is wrong or revoked. Create a new one at [openrouter.ai/keys](https://openrouter.ai/keys). |
| `OpenRouter 402: …` | Your OpenRouter account is out of credits. |
| `OpenRouter 400: … not a valid model ID` | Check the model id against [openrouter.ai/models](https://openrouter.ai/models). |
| `OpenRouter 429: Provider returned error` | The model's provider is rate-limiting. Send again in a few seconds, or pick another model. |
| `AI returned an empty reply` | A one-off glitch from the provider. Send again. |
| `AI reply too long (2350/2000)` | The model wrote more than Discord allows. Send again, or add a rule like "It must be under 1500 characters." |
| `OpenRouter request timed out` | No answer within 30 seconds. Try again or use a faster model. |
| The model answers your message instead of rewriting it | Use a stronger model (Grok), or soften role-play rules. Small models get this wrong more often. |
| No sparkle icon | Check that Vesktop's Vencord Location points at `Vencord/dist`, that AiWriter is enabled in Plugins, and that you fully quit and restarted Vesktop. |
| Changes don't show up after rebuilding | Quit Vesktop from the tray and start it again. Part of the plugin runs in Vesktop's main process, which only reloads on a full restart. |

## Updating

```bash
# Get the latest plugin
cd vencord-ai-writer
git pull

# Get the latest Vencord (Vesktop no longer updates it for you once you use your own build)
cd Vencord
git pull
npx pnpm@11.9.0 install --frozen-lockfile
npx pnpm@11.9.0 build
```

If Vencord bumps its pnpm version, use the one in `Vencord/package.json` (`"packageManager"`). Afterwards, quit Vesktop from the tray and start it again.

## Development

```
aiWriter/
├── index.tsx          plugin definition: toggle button, send/edit hooks
├── ai.ts              OpenRouter request, prompt building, mention masking (no Vencord imports, unit-tested)
├── native.ts          runs ai.ts in Vesktop's main process
├── settings.ts        plugin settings and defaults
├── SettingsModal.tsx  the right-click settings window
└── tsconfig.json      extends Vencord's tsconfig so the build resolves @api/@utils imports
tests/ai.test.ts       unit tests for ai.ts
```

Two things to know before changing it:

- **Network requests go through `native.ts`.** Discord's Content Security Policy blocks the Discord page from calling `openrouter.ai`, so the request runs in Vesktop's main process instead (the same approach as Vencord's built-in Translate plugin). Any new external HTTP call has to go through there too.
- **Mentions are masked.** Before calling the model, `ai.ts` swaps tokens like `<@123>` and `<:emoji:456>` for placeholders like `⟦0⟧`, then swaps them back in the reply.

Run the tests from the repo root. Node 22.18+ runs the TypeScript directly:

```bash
node --test tests/
```

Rebuild after changes:

```bash
cd Vencord && npx pnpm@11.9.0 build
```
