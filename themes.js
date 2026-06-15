// Single source of truth for the floating Download button's themes.
//
// Loaded by content.js (injected onto reddit.com) AND popup.html (live preview).
// Define a theme once here and both contexts pick it up. Content-script CSS needs
// !important to defend against Reddit's own styles; the popup doesn't. That's
// handled by the buildThemeStyles helper at call time, so the data stays clean.

const REDDIT_BUTTON_THEMES = [
    {
        id: 'theme-native',
        rest: 'background: linear-gradient(135deg, #FF4500 0%, #FF8C00 100%); color: white; border: none; border-radius: 50px; box-shadow: 0 8px 16px rgba(255, 69, 0, 0.25);',
        hover: 'transform: translateY(-3px); box-shadow: 0 12px 20px rgba(255, 69, 0, 0.35);'
    },
    {
        id: 'theme-premium',
        rest: 'background-color: #0F0F0F; color: #FFFFFF; border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3); letter-spacing: 0.3px;',
        hover: 'background-color: #202020; transform: translateY(-2px); box-shadow: 0 6px 16px rgba(0, 0, 0, 0.4);'
    },
    {
        id: 'theme-modern',
        rest: 'background-color: #1A73E8; color: #FFFFFF; border: none; border-radius: 8px; box-shadow: 0 4px 12px rgba(26, 115, 232, 0.3);',
        hover: 'background-color: #1557B0; transform: translateY(-2px); box-shadow: 0 6px 16px rgba(26, 115, 232, 0.4);'
    },
    {
        id: 'theme-minimal',
        rest: 'background-color: #FFFFFF; color: #3C4043; border: 1px solid #DADCE0; border-radius: 8px; box-shadow: 0 2px 6px rgba(0,0,0,0.05);',
        hover: 'background-color: #F8F9FA; color: #202124; border-color: #BDC1C6; transform: translateY(-2px); box-shadow: 0 4px 10px rgba(0,0,0,0.1);'
    },
    {
        id: 'theme-glass',
        rest: 'background: rgba(255,255,255,0.15); backdrop-filter: blur(14px) saturate(180%); -webkit-backdrop-filter: blur(14px) saturate(180%); color: #ffffff; border: 1px solid rgba(255,255,255,0.25); border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.2);',
        hover: 'background: rgba(255,255,255,0.22); transform: translateY(-2px);'
    },
    {
        id: 'theme-gradient',
        rest: 'background: linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%); color: #ffffff; border: none; border-radius: 12px; box-shadow: 0 8px 24px rgba(118, 75, 162, 0.4);',
        hover: 'transform: translateY(-3px); box-shadow: 0 12px 32px rgba(118, 75, 162, 0.5);'
    },
    {
        id: 'theme-neon',
        rest: 'background-color: #0a0a0a; color: #00ffd1; border: 1px solid #00ffd1; border-radius: 6px; box-shadow: 0 0 12px rgba(0, 255, 209, 0.5), inset 0 0 8px rgba(0, 255, 209, 0.1); text-shadow: 0 0 6px rgba(0, 255, 209, 0.7); letter-spacing: 0.5px;',
        hover: 'box-shadow: 0 0 18px rgba(0, 255, 209, 0.7), inset 0 0 12px rgba(0, 255, 209, 0.15); transform: translateY(-2px);'
    },
    {
        id: 'theme-soft',
        rest: 'background-color: #f0f0f3; color: #2d3748; border: none; border-radius: 16px; box-shadow: 6px 6px 12px rgba(174, 174, 192, 0.5), -6px -6px 12px rgba(255, 255, 255, 0.95);',
        hover: 'box-shadow: inset 4px 4px 8px rgba(174, 174, 192, 0.4), inset -4px -4px 8px rgba(255,255,255,0.9);'
    },
    {
        id: 'theme-mint',
        rest: 'background-color: #10B981; color: #FFFFFF; border: none; border-radius: 50px; box-shadow: 0 6px 16px rgba(16, 185, 129, 0.35);',
        hover: 'background-color: #059669; transform: translateY(-2px);'
    },
    {
        id: 'theme-sunset',
        rest: 'background: linear-gradient(135deg, #FF6B6B 0%, #FFD93D 100%); color: #2d1810; border: none; border-radius: 50px; box-shadow: 0 6px 18px rgba(255, 107, 107, 0.35);',
        hover: 'transform: translateY(-2px); box-shadow: 0 10px 24px rgba(255, 107, 107, 0.45);'
    },
    {
        id: 'theme-mono',
        rest: 'background-color: transparent; color: currentColor; border: 1.5px solid currentColor; border-radius: 6px; box-shadow: none;',
        hover: 'background-color: rgba(0,0,0,0.05);'
    }
];

// Stamp out CSS for a given target selector, optionally tagging every declaration
// with !important. content.js calls with { important: true } so Reddit's own
// styles don't override us; the popup calls without it.
function buildThemeStyles(selector, opts) {
    opts = opts || {};
    const suffix = opts.important ? ' !important' : '';

    // Split a declaration block on top-level `;` only — `;` inside parens or
    // quoted strings is part of a value (e.g. url("data:...; base64, ..."),
    // a future cubic-bezier with a list, etc.) and must not break declarations.
    const splitDecls = (css) => {
        const out = [];
        let depth = 0, quote = null, buf = '';
        for (let i = 0; i < css.length; i++) {
            const ch = css[i];
            if (quote) {
                buf += ch;
                if (ch === quote && css[i - 1] !== '\\') quote = null;
                continue;
            }
            if (ch === '"' || ch === "'") { quote = ch; buf += ch; continue; }
            if (ch === '(') { depth++; buf += ch; continue; }
            if (ch === ')') { depth = Math.max(0, depth - 1); buf += ch; continue; }
            if (ch === ';' && depth === 0) {
                const t = buf.trim();
                if (t) out.push(t);
                buf = '';
                continue;
            }
            buf += ch;
        }
        const tail = buf.trim();
        if (tail) out.push(tail);
        return out;
    };

    const stamp = (decls) => {
        if (!suffix) return decls;
        return splitDecls(decls)
            .map(d => d.includes('!important') ? d : d + suffix)
            .join('; ') + ';';
    };

    return REDDIT_BUTTON_THEMES.map(t => {
        const restRule = `${selector}[data-theme="${t.id}"] { ${stamp(t.rest)} }`;
        if (!t.hover) return restRule;
        const hoverRule = `${selector}[data-theme="${t.id}"]:hover { ${stamp(t.hover)} }`;
        return restRule + '\n' + hoverRule;
    }).join('\n');
}
