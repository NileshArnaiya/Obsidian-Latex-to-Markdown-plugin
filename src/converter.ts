import { PluginSettings } from './settings';

/**
 * Converts LaTeX content to Obsidian-flavored Markdown.
 */
export function convertLatexToMarkdown(latex: string, settings: PluginSettings): string {
    let result = latex;

    // ── Phase 1: Strip preamble & document wrapper ──────────────────────
    result = stripPreamble(result);

    // ── Phase 2: Preserve math environments (protect from further processing) ──
    const mathBlocks: string[] = [];
    result = protectMathEnvironments(result, mathBlocks);

    // ── Phase 3: Preserve verbatim / lstlisting blocks ─────────────────
    const codeBlocks: string[] = [];
    result = protectCodeBlocks(result, codeBlocks);

    // ── Phase 4: Convert document structure ─────────────────────────────
    result = convertSections(result, settings.headingOffset);
    result = convertFormatting(result);
    result = convertLists(result);
    result = convertTables(result);
    result = convertImages(result);
    result = convertLinks(result);

    if (settings.convertCitations) {
        result = convertCitations(result);
    }

    result = convertLabelsAndRefs(result, settings.useWikilinks);

    // ── Phase 5: Handle comments ────────────────────────────────────────
    if (!settings.preserveComments) {
        result = stripComments(result);
    } else {
        result = convertComments(result);
    }

    // ── Phase 6: Clean up miscellaneous LaTeX commands ──────────────────
    result = cleanupMisc(result);

    // ── Phase 7: Restore protected blocks ───────────────────────────────
    result = restoreCodeBlocks(result, codeBlocks);
    result = restoreMathBlocks(result, mathBlocks, settings.mathDelimiterStyle);

    // ── Phase 8: Final normalization ────────────────────────────────────
    result = normalizeWhitespace(result);

    return result.trim();
}

// ════════════════════════════════════════════════════════════════════════
// Helper functions
// ════════════════════════════════════════════════════════════════════════

function stripPreamble(text: string): string {
    // Remove everything before \begin{document} (if present)
    const beginDoc = text.indexOf('\\begin{document}');
    if (beginDoc !== -1) {
        text = text.substring(beginDoc + '\\begin{document}'.length);
    }
    // Remove \end{document}
    text = text.replace(/\\end\{document\}/g, '');
    // Remove common preamble commands that may appear inline
    text = text.replace(/\\documentclass(\[.*?\])?\{.*?\}/g, '');
    text = text.replace(/\\usepackage(\[.*?\])?\{.*?\}/g, '');
    text = text.replace(/\\title\{(.*?)\}/g, '# $1');
    text = text.replace(/\\author\{(.*?)\}/g, '*Author: $1*');
    text = text.replace(/\\date\{(.*?)\}/g, '*Date: $1*');
    text = text.replace(/\\maketitle/g, '');
    return text;
}

/** Replace math environments with placeholders to protect them from text processing */
function protectMathEnvironments(text: string, store: string[]): string {
    // Display math: \[ ... \]
    text = text.replace(/\\\[([\s\S]*?)\\\]/g, (_match, content) => {
        store.push(content);
        return `%%MATH_BLOCK_${store.length - 1}%%`;
    });

    // Display math: $$ ... $$
    text = text.replace(/\$\$([\s\S]*?)\$\$/g, (_match, content) => {
        store.push(content);
        return `%%MATH_BLOCK_${store.length - 1}%%`;
    });

    // Named math environments: equation, align, gather, multline, etc.
    const mathEnvs = ['equation', 'equation\\*', 'align', 'align\\*', 'gather', 'gather\\*',
        'multline', 'multline\\*', 'eqnarray', 'eqnarray\\*', 'flalign', 'flalign\\*',
        'math', 'displaymath'];
    for (const env of mathEnvs) {
        const regex = new RegExp(`\\\\begin\\{${env}\\}([\\s\\S]*?)\\\\end\\{${env}\\}`, 'g');
        text = text.replace(regex, (_match, content) => {
            store.push(content);
            return `%%MATH_BLOCK_${store.length - 1}%%`;
        });
    }

    // Inline math: $ ... $ (non-greedy, single line)
    text = text.replace(/\$([^$\n]+?)\$/g, (_match, content) => {
        store.push(content);
        return `%%MATH_INLINE_${store.length - 1}%%`;
    });

    // Inline math: \( ... \)
    text = text.replace(/\\\(([\s\S]*?)\\\)/g, (_match, content) => {
        store.push(content);
        return `%%MATH_INLINE_${store.length - 1}%%`;
    });

    return text;
}

function protectCodeBlocks(text: string, store: string[]): string {
    // verbatim environment
    text = text.replace(/\\begin\{verbatim\}([\s\S]*?)\\end\{verbatim\}/g, (_match, content) => {
        store.push(content);
        return `%%CODE_BLOCK_${store.length - 1}%%`;
    });
    // lstlisting environment
    text = text.replace(/\\begin\{lstlisting\}(\[.*?\])?([\s\S]*?)\\end\{lstlisting\}/g, (_match, _opts, content) => {
        store.push(content);
        return `%%CODE_BLOCK_${store.length - 1}%%`;
    });
    // minted environment
    text = text.replace(/\\begin\{minted\}\{(\w+)\}([\s\S]*?)\\end\{minted\}/g, (_match, lang, content) => {
        store.push(`\`\`\`${lang}\n${content.trim()}\n\`\`\``);
        return `%%CODE_BLOCK_${store.length - 1}%%`;
    });
    // \verb|...|
    text = text.replace(/\\verb\|([^|]*?)\|/g, '`$1`');
    text = text.replace(/\\verb\+([^+]*?)\+/g, '`$1`');
    return text;
}

function convertSections(text: string, offset: number): string {
    const levels: [RegExp, number][] = [
        [/\\chapter\*?\{(.*?)\}/g, 1],
        [/\\section\*?\{(.*?)\}/g, 2],
        [/\\subsection\*?\{(.*?)\}/g, 3],
        [/\\subsubsection\*?\{(.*?)\}/g, 4],
        [/\\paragraph\*?\{(.*?)\}/g, 5],
        [/\\subparagraph\*?\{(.*?)\}/g, 6],
    ];

    for (const [regex, level] of levels) {
        const effectiveLevel = Math.min(level + offset, 6);
        const hashes = '#'.repeat(effectiveLevel);
        text = text.replace(regex, `\n${hashes} $1\n`);
    }

    return text;
}

function convertFormatting(text: string): string {
    // Bold
    text = text.replace(/\\textbf\{(.*?)\}/g, '**$1**');
    text = text.replace(/\{\\bf\s+(.*?)\}/g, '**$1**');
    text = text.replace(/\\mathbf\{(.*?)\}/g, '**$1**');

    // Italic
    text = text.replace(/\\textit\{(.*?)\}/g, '*$1*');
    text = text.replace(/\\emph\{(.*?)\}/g, '*$1*');
    text = text.replace(/\{\\it\s+(.*?)\}/g, '*$1*');
    text = text.replace(/\{\\em\s+(.*?)\}/g, '*$1*');

    // Bold + Italic
    text = text.replace(/\\textbf\{\\textit\{(.*?)\}\}/g, '***$1***');
    text = text.replace(/\\textit\{\\textbf\{(.*?)\}\}/g, '***$1***');

    // Underline
    text = text.replace(/\\underline\{(.*?)\}/g, '<u>$1</u>');

    // Strikethrough
    text = text.replace(/\\sout\{(.*?)\}/g, '~~$1~~');
    text = text.replace(/\\st\{(.*?)\}/g, '~~$1~~');

    // Monospace / code
    text = text.replace(/\\texttt\{(.*?)\}/g, '`$1`');
    text = text.replace(/\\textsc\{(.*?)\}/g, '$1');

    // Quotes
    text = text.replace(/``(.*?)''/g, '"$1"');
    text = text.replace(/`(.*?)'/g, "'$1'");

    // Font size commands (strip them, keep content)
    const fontSizes = ['tiny', 'scriptsize', 'footnotesize', 'small', 'normalsize',
        'large', 'Large', 'LARGE', 'huge', 'Huge'];
    for (const size of fontSizes) {
        text = text.replace(new RegExp(`\\{\\\\${size}\\s+([\\s\\S]*?)\\}`, 'g'), '$1');
        text = text.replace(new RegExp(`\\\\${size}\\b`, 'g'), '');
    }

    // Footnotes
    text = text.replace(/\\footnote\{(.*?)\}/g, '[^$1]');

    return text;
}

function convertLists(text: string): string {
    // itemize → unordered list
    text = text.replace(/\\begin\{itemize\}([\s\S]*?)\\end\{itemize\}/g, (_match, content: string) => {
        return convertItemsToList(content, false);
    });

    // enumerate → ordered list
    text = text.replace(/\\begin\{enumerate\}([\s\S]*?)\\end\{enumerate\}/g, (_match, content: string) => {
        return convertItemsToList(content, true);
    });

    // description list
    text = text.replace(/\\begin\{description\}([\s\S]*?)\\end\{description\}/g, (_match, content: string) => {
        return convertItemsToList(content, false);
    });

    return text;
}

function convertItemsToList(content: string, ordered: boolean): string {
    const items = content.split('\\item').filter(s => s.trim().length > 0);
    return '\n' + items.map((item, i) => {
        // Handle description items: \item[label] text
        let text = item.trim();
        const descMatch = text.match(/^\[(.*?)\]\s*([\s\S]*)/);
        if (descMatch) {
            text = `**${descMatch[1]}**: ${descMatch[2].trim()}`;
        }
        const prefix = ordered ? `${i + 1}. ` : '- ';
        return prefix + text;
    }).join('\n') + '\n';
}

function convertTables(text: string): string {
    // Match tabular environments
    text = text.replace(/\\begin\{(?:tabular|tabularx|longtable)\}(?:\{[^}]*\})?([\s\S]*?)\\end\{(?:tabular|tabularx|longtable)\}/g, (_match, content: string) => {
        return convertTabularToMarkdown(content);
    });

    // Strip table/figure wrappers but keep content
    text = text.replace(/\\begin\{table\}(\[.*?\])?/g, '');
    text = text.replace(/\\end\{table\}/g, '');
    text = text.replace(/\\begin\{figure\}(\[.*?\])?/g, '');
    text = text.replace(/\\end\{figure\}/g, '');
    text = text.replace(/\\centering/g, '');
    text = text.replace(/\\caption\{(.*?)\}/g, '*$1*');

    return text;
}

function convertTabularToMarkdown(content: string): string {
    // Strip \hline, \toprule, \midrule, \bottomrule, \cline
    content = content.replace(/\\(?:hline|toprule|midrule|bottomrule|cline\{.*?\})/g, '');
    // Strip \multicolumn for now (flatten)
    content = content.replace(/\\multicolumn\{\d+\}\{[^}]*\}\{(.*?)\}/g, '$1');

    // Split into rows by \\
    const rows = content.split('\\\\')
        .map(r => r.trim())
        .filter(r => r.length > 0);

    if (rows.length === 0) return '';

    const mdRows = rows.map(row => {
        const cells = row.split('&').map(c => c.trim());
        return '| ' + cells.join(' | ') + ' |';
    });

    // Insert separator after first row (header)
    if (mdRows.length >= 1) {
        const colCount = rows[0].split('&').length;
        const separator = '| ' + Array(colCount).fill('---').join(' | ') + ' |';
        mdRows.splice(1, 0, separator);
    }

    return '\n' + mdRows.join('\n') + '\n';
}

function convertImages(text: string): string {
    // \includegraphics[options]{path}
    text = text.replace(/\\includegraphics(\[.*?\])?\{(.*?)\}/g, '![]($2)');
    return text;
}

function convertLinks(text: string): string {
    // \href{url}{text}
    text = text.replace(/\\href\{(.*?)\}\{(.*?)\}/g, '[$2]($1)');
    // \url{url}
    text = text.replace(/\\url\{(.*?)\}/g, '<$1>');
    return text;
}

function convertCitations(text: string): string {
    // \cite{key1,key2} → [key1, key2]
    text = text.replace(/\\cite\{(.*?)\}/g, (_match, keys: string) => {
        return '[' + keys.split(',').map((k: string) => k.trim()).join(', ') + ']';
    });
    // \citep, \citet variants
    text = text.replace(/\\cite[pt]\{(.*?)\}/g, (_match, keys: string) => {
        return '[' + keys.split(',').map((k: string) => k.trim()).join(', ') + ']';
    });
    // \autocite
    text = text.replace(/\\autocite\{(.*?)\}/g, (_match, keys: string) => {
        return '[' + keys.split(',').map((k: string) => k.trim()).join(', ') + ']';
    });

    // bibliography environment → strip
    text = text.replace(/\\begin\{thebibliography\}[\s\S]*?\\end\{thebibliography\}/g, '');
    text = text.replace(/\\bibliography\{.*?\}/g, '');
    text = text.replace(/\\bibliographystyle\{.*?\}/g, '');

    return text;
}

function convertLabelsAndRefs(text: string, useWikilinks: boolean): string {
    // \label{key} → strip (labels are metadata)
    text = text.replace(/\\label\{(.*?)\}/g, '');

    if (useWikilinks) {
        // \ref{key} → [[key]]
        text = text.replace(/\\ref\{(.*?)\}/g, '[[#$1]]');
        text = text.replace(/\\eqref\{(.*?)\}/g, '([[#$1]])');
        text = text.replace(/\\pageref\{(.*?)\}/g, '[[#$1]]');
    } else {
        text = text.replace(/\\ref\{(.*?)\}/g, '[$1](#$1)');
        text = text.replace(/\\eqref\{(.*?)\}/g, '([$1](#$1))');
        text = text.replace(/\\pageref\{(.*?)\}/g, '[$1](#$1)');
    }

    return text;
}

function stripComments(text: string): string {
    // Remove lines that are only comments
    text = text.replace(/^\s*%.*$/gm, '');
    // Remove inline comments (but not \%)
    text = text.replace(/(?<!\\)%.*$/gm, '');
    return text;
}

function convertComments(text: string): string {
    // Convert LaTeX comments to HTML comments
    text = text.replace(/(?<!\\)%(.*)$/gm, '<!-- $1 -->');
    return text;
}

function cleanupMisc(text: string): string {
    // Abstract
    text = text.replace(/\\begin\{abstract\}([\s\S]*?)\\end\{abstract\}/g, '\n> **Abstract:** $1\n');

    // Quote / quotation
    text = text.replace(/\\begin\{quote\}([\s\S]*?)\\end\{quote\}/g, (_match, content: string) => {
        return '\n' + content.trim().split('\n').map((l: string) => '> ' + l.trim()).join('\n') + '\n';
    });
    text = text.replace(/\\begin\{quotation\}([\s\S]*?)\\end\{quotation\}/g, (_match, content: string) => {
        return '\n' + content.trim().split('\n').map((l: string) => '> ' + l.trim()).join('\n') + '\n';
    });

    // Center environment
    text = text.replace(/\\begin\{center\}([\s\S]*?)\\end\{center\}/g, '$1');

    // Minipage, flushleft, flushright
    text = text.replace(/\\begin\{(?:minipage|flushleft|flushright)\}(?:\{[^}]*\})?([\s\S]*?)\\end\{(?:minipage|flushleft|flushright)\}/g, '$1');

    // Horizontal rules
    text = text.replace(/\\(?:hrule|rule\{\\linewidth\}\{.*?\})/g, '\n---\n');

    // Line breaks
    text = text.replace(/\\\\\s*$/gm, '  ');
    text = text.replace(/\\newline/g, '  \n');
    text = text.replace(/\\linebreak/g, '  \n');

    // Non-breaking space
    text = text.replace(/~/g, ' ');

    // Common special characters
    text = text.replace(/\\&/g, '&');
    text = text.replace(/\\%/g, '%');
    text = text.replace(/\\\$/g, '$');
    text = text.replace(/\\_/g, '_');
    text = text.replace(/\\#/g, '#');
    text = text.replace(/\\\{/g, '{');
    text = text.replace(/\\\}/g, '}');
    text = text.replace(/\\textbackslash/g, '\\');

    // Dashes
    text = text.replace(/---/g, '—');
    text = text.replace(/--/g, '–');

    // Ellipsis
    text = text.replace(/\\ldots/g, '…');
    text = text.replace(/\\dots/g, '…');

    // Accented characters (common ones)
    const accents: Record<string, Record<string, string>> = {
        "'": { 'e': 'é', 'a': 'á', 'i': 'í', 'o': 'ó', 'u': 'ú', 'E': 'É', 'A': 'Á' },
        '`': { 'e': 'è', 'a': 'à', 'i': 'ì', 'o': 'ò', 'u': 'ù', 'E': 'È', 'A': 'À' },
        '^': { 'e': 'ê', 'a': 'â', 'i': 'î', 'o': 'ô', 'u': 'û', 'E': 'Ê' },
        '"': { 'e': 'ë', 'a': 'ä', 'i': 'ï', 'o': 'ö', 'u': 'ü', 'E': 'Ë', 'O': 'Ö', 'U': 'Ü' },
        '~': { 'n': 'ñ', 'a': 'ã', 'o': 'õ', 'N': 'Ñ' },
        'c': { 'c': 'ç', 'C': 'Ç' },
    };

    for (const [accent, chars] of Object.entries(accents)) {
        for (const [char, replacement] of Object.entries(chars)) {
            const escapedAccent = accent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            // \'{e} and \'e forms
            text = text.replace(new RegExp(`\\\\${escapedAccent}\\{${char}\\}`, 'g'), replacement);
            text = text.replace(new RegExp(`\\\\${escapedAccent}${char}`, 'g'), replacement);
        }
    }

    // Remove remaining unknown \commands (that take no arguments)
    // Be conservative: only strip well-known no-op commands
    const noopCommands = ['clearpage', 'cleardoublepage', 'newpage', 'tableofcontents',
        'listoffigures', 'listoftables', 'appendix', 'frontmatter', 'mainmatter',
        'backmatter', 'noindent', 'indent', 'bigskip', 'medskip', 'smallskip',
        'vfill', 'hfill', 'vspace\\*?\\{[^}]*\\}', 'hspace\\*?\\{[^}]*\\}',
        'phantom\\{[^}]*\\}', 'input\\{[^}]*\\}', 'include\\{[^}]*\\}'];
    for (const cmd of noopCommands) {
        text = text.replace(new RegExp(`\\\\${cmd}`, 'g'), '');
    }

    return text;
}

function restoreCodeBlocks(text: string, store: string[]): string {
    for (let i = 0; i < store.length; i++) {
        const placeholder = `%%CODE_BLOCK_${i}%%`;
        const content = store[i];
        // If it already has ``` (from minted), use as-is
        const codeBlock = content.startsWith('```') ? '\n' + content + '\n' : '\n```\n' + content.trim() + '\n```\n';
        text = text.replace(placeholder, codeBlock);
    }
    return text;
}

function restoreMathBlocks(text: string, store: string[], style: 'dollar' | 'brackets'): string {
    for (let i = 0; i < store.length; i++) {
        const blockPlaceholder = `%%MATH_BLOCK_${i}%%`;
        const inlinePlaceholder = `%%MATH_INLINE_${i}%%`;

        if (text.includes(blockPlaceholder)) {
            if (style === 'dollar') {
                text = text.replace(blockPlaceholder, `\n$$\n${store[i].trim()}\n$$\n`);
            } else {
                text = text.replace(blockPlaceholder, `\n\\[\n${store[i].trim()}\n\\]\n`);
            }
        }
        if (text.includes(inlinePlaceholder)) {
            if (style === 'dollar') {
                text = text.replace(inlinePlaceholder, `$${store[i]}$`);
            } else {
                text = text.replace(inlinePlaceholder, `\\(${store[i]}\\)`);
            }
        }
    }
    return text;
}

function normalizeWhitespace(text: string): string {
    // Collapse 3+ blank lines into 2
    text = text.replace(/\n{3,}/g, '\n\n');
    // Remove trailing whitespace on each line
    text = text.replace(/[ \t]+$/gm, '');
    return text;
}
