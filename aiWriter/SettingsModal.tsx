import { FormSwitch } from "@components/FormSwitch";
import { HeadingSecondary } from "@components/Heading";
import { RenderModalProps } from "@vencord/discord-types";
import { Modal, openModal, TextArea, TextInput, useState } from "@webpack/common";

import { settings } from "./settings";

function SettingsModal({ modalProps }: { modalProps: RenderModalProps; }) {
    const [prompt, setPrompt] = useState(settings.store.prompt);
    const [model, setModel] = useState(settings.store.model);
    const [apiKey, setApiKey] = useState(settings.store.apiKey);
    const [rewriteEdits, setRewriteEdits] = useState(settings.store.rewriteEdits);

    function save() {
        Object.assign(settings.store, { prompt, model: model.trim(), apiKey: apiKey.trim(), rewriteEdits });
        modalProps.onClose();
    }

    return (
        <Modal
            {...modalProps}
            title="AI Writer"
            actions={[
                { text: "Cancel", variant: "secondary", onClick: modalProps.onClose },
                { text: "Save", variant: "primary", onClick: save }
            ]}
        >
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <section>
                    <HeadingSecondary>Instructions</HeadingSecondary>
                    <TextArea
                        value={prompt}
                        onChange={setPrompt}
                        rows={6}
                        placeholder="e.g. Make it sound casual and fix my spelling. No need to say 'reply with only the message', that's built in."
                    />
                </section>
                <section>
                    <HeadingSecondary>Model</HeadingSecondary>
                    <TextInput value={model} onChange={setModel} placeholder="anthropic/claude-sonnet-5-5" />
                </section>
                <section>
                    <HeadingSecondary>OpenRouter API key</HeadingSecondary>
                    <TextInput type="password" value={apiKey} onChange={setApiKey} placeholder="sk-or-..." />
                </section>
                <FormSwitch
                    title="Also rewrite edits"
                    description="When AI mode is on, edited messages are rewritten too"
                    value={rewriteEdits}
                    onChange={setRewriteEdits}
                    hideBorder
                />
            </div>
        </Modal>
    );
}

export function openSettingsModal() {
    openModal(modalProps => <SettingsModal modalProps={modalProps} />);
}
