import { Plugin, PluginSettingTab, App, Setting, Notice, Editor, MarkdownView, TFile, Modal } from 'obsidian';
import { convertLatexToMarkdown } from './src/converter';
import { PluginSettings, DEFAULT_SETTINGS } from './src/settings';

export default class LatexToMarkdownPlugin extends Plugin {
    settings: PluginSettings;

    async onload() {
        await this.loadSettings();

        // ── Ribbon icon ─────────────────────────────────────────────────
        this.addRibbonIcon('file-input', 'Convert LaTeX to markdown', () => {
            const view = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (view) {
                this.convertActiveNote(view.editor);
            } else {
                new Notice('Open a note first to convert LaTeX.');
            }
        });

        // ── Command: Convert selection or entire note ────────────────────
        this.addCommand({
            id: 'convert',
            name: 'Convert current note or selection',
            editorCallback: (editor: Editor) => {
                this.convertActiveNote(editor);
            },
        });

        // ── Command: Import .tex file ────────────────────────────────────
        this.addCommand({
            id: 'import',
            name: 'Import file',
            callback: () => {
                this.importLatexFile();
            },
        });

        // ── Command: Paste clipboard as Markdown ─────────────────────────
        this.addCommand({
            id: 'paste',
            name: 'Paste as markdown',
            editorCallback: (editor: Editor) => {
                this.pasteLatexAsMarkdown(editor).catch(console.error);
            },
        });

        // ── Command: Preview conversion ──────────────────────────────────
        this.addCommand({
            id: 'preview',
            name: 'Preview conversion',
            editorCallback: (editor: Editor) => {
                this.previewConversion(editor);
            },
        });

        // ── Settings tab ─────────────────────────────────────────────────
        this.addSettingTab(new LatexToMarkdownSettingTab(this.app, this));
    }

    onunload() {
        // cleanup if needed
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    // ════════════════════════════════════════════════════════════════════
    // Core actions
    // ════════════════════════════════════════════════════════════════════

    private convertActiveNote(editor: Editor) {
        const selection = editor.getSelection();

        if (selection && selection.trim().length > 0) {
            // Convert selected text
            const converted = convertLatexToMarkdown(selection, this.settings);
            editor.replaceSelection(converted);
            new Notice('✅ Selection converted from LaTeX to Markdown.');
        } else {
            // Convert entire note
            const content = editor.getValue();
            const converted = convertLatexToMarkdown(content, this.settings);
            editor.setValue(converted);
            new Notice('✅ Entire note converted from LaTeX to Markdown.');
        }
    }

    private importLatexFile(): void {
        // Create an invisible file input element
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.tex,.latex,.ltx';
        input.setCssProps({ display: 'none' });
        document.body.appendChild(input);

        input.addEventListener('change', () => {
            const processFile = async () => {
                const file = input.files?.[0];
                if (!file) {
                    return;
                }

                const text = await file.text();
                const converted = convertLatexToMarkdown(text, this.settings);

                // Create new note with the converted content
                const baseName = file.name.replace(/\.(tex|latex|ltx)$/, '');
                let fileName = `${baseName}.md`;
                let counter = 1;

                // Ensure unique filename
                while (this.app.vault.getAbstractFileByPath(fileName)) {
                    fileName = `${baseName} (${counter}).md`;
                    counter++;
                }

                const newFile = await this.app.vault.create(fileName, converted);
                const leaf = this.app.workspace.getLeaf(false);
                if (newFile instanceof TFile) {
                    await leaf.openFile(newFile);
                }

                new Notice(`✅ Imported "${file.name}" as "${fileName}".`);
            };

            processFile()
                .catch(err => {
                    new Notice(`❌ Error importing file: ${err}`);
                    console.error('LaTeX import error:', err);
                })
                .finally(() => {
                    document.body.removeChild(input);
                });
        });

        input.click();
    }

    private async pasteLatexAsMarkdown(editor: Editor) {
        try {
            const clipboardText = await navigator.clipboard.readText();

            if (!clipboardText || clipboardText.trim().length === 0) {
                new Notice('📋 Clipboard is empty.');
                return;
            }

            const converted = convertLatexToMarkdown(clipboardText, this.settings);
            editor.replaceSelection(converted);
            new Notice('✅ Pasted and converted LaTeX from clipboard.');
        } catch (err) {
            new Notice('❌ Could not read clipboard. Check permissions.');
            console.error('Clipboard error:', err);
        }
    }

    private previewConversion(editor: Editor) {
        const selection = editor.getSelection();
        const source = (selection && selection.trim().length > 0) ? selection : editor.getValue();
        const converted = convertLatexToMarkdown(source, this.settings);
        new ConversionPreviewModal(this.app, source, converted, (result: string) => {
            if (selection && selection.trim().length > 0) {
                editor.replaceSelection(result);
            } else {
                editor.setValue(result);
            }
        }).open();
    }
}

// ════════════════════════════════════════════════════════════════════════
// Preview Modal
// ════════════════════════════════════════════════════════════════════════

class ConversionPreviewModal extends Modal {
    private source: string;
    private converted: string;
    private onAccept: (result: string) => void;

    constructor(app: App, source: string, converted: string, onAccept: (result: string) => void) {
        super(app);
        this.source = source;
        this.converted = converted;
        this.onAccept = onAccept;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.addClass('latex-to-md-preview-modal');

        contentEl.createEl('h2', { text: 'LaTeX to markdown preview' });

        // Side-by-side panels
        const container = contentEl.createDiv({ cls: 'latex-to-md-preview-container' });

        const leftPanel = container.createDiv({ cls: 'latex-to-md-preview-panel' });
        leftPanel.createEl('h3', { text: 'LaTeX Source' });
        const sourceEl = leftPanel.createEl('pre', { cls: 'latex-to-md-preview-code' });
        sourceEl.createEl('code', { text: this.source });

        const rightPanel = container.createDiv({ cls: 'latex-to-md-preview-panel' });
        rightPanel.createEl('h3', { text: 'Markdown Output' });
        const outputEl = rightPanel.createEl('pre', { cls: 'latex-to-md-preview-code' });
        outputEl.createEl('code', { text: this.converted });

        // Buttons
        const buttonContainer = contentEl.createDiv({ cls: 'latex-to-md-preview-buttons' });
        const acceptBtn = buttonContainer.createEl('button', { text: 'Apply Conversion', cls: 'mod-cta' });
        acceptBtn.addEventListener('click', () => {
            this.onAccept(this.converted);
            new Notice('✅ Conversion applied.');
            this.close();
        });
        const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
        cancelBtn.addEventListener('click', () => {
            this.close();
        });
    }

    onClose() {
        this.contentEl.empty();
    }
}

// ════════════════════════════════════════════════════════════════════════
// Settings Tab
// ════════════════════════════════════════════════════════════════════════

class LatexToMarkdownSettingTab extends PluginSettingTab {
    plugin: LatexToMarkdownPlugin;

    constructor(app: App, plugin: LatexToMarkdownPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        new Setting(containerEl).setHeading().setName('LaTeX to markdown settings');

        new Setting(containerEl)
            .setName('Heading offset')
            .setDesc('Add this value to heading levels (e.g. 1 makes \\section become ## instead of #).')
            .addSlider(slider => slider
                .setLimits(0, 4, 1)
                .setValue(this.plugin.settings.headingOffset)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.headingOffset = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Math delimiter style')
            .setDesc('Choose the delimiter style for math blocks in the output.')
            .addDropdown(dropdown => dropdown
                .addOption('dollar', '$$ (dollar signs)')
                .addOption('brackets', '\\[ \\] (brackets)')
                .setValue(this.plugin.settings.mathDelimiterStyle)
                .onChange(async (value) => {
                    this.plugin.settings.mathDelimiterStyle = value as 'dollar' | 'brackets';
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Use wikilinks for references')
            .setDesc('Convert \\ref{} to [[#label]] (wikilink) instead of [label](#label).')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.useWikilinks)
                .onChange(async (value) => {
                    this.plugin.settings.useWikilinks = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Preserve LaTeX comments')
            .setDesc('Convert % comments to HTML comments instead of removing them.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.preserveComments)
                .onChange(async (value) => {
                    this.plugin.settings.preserveComments = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Convert citations')
            .setDesc('Convert \\cite{} to [key] notation. Disable if you prefer raw citation keys.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.convertCitations)
                .onChange(async (value) => {
                    this.plugin.settings.convertCitations = value;
                    await this.plugin.saveSettings();
                }));
    }
}
