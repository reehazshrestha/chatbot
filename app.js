// Apple UI Design System – Verified: 8pt Grid, SF Pro Typography, Material-Depth, Natural Spring Motion
'use strict';

/* ==================== Utilities ==================== */
const $ = (sel) => document.querySelector(sel);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function relTime(ts) {
  const d = Date.now() - ts;
  const m = Math.floor(d / 60000);
  if (m < 1) return 'Now';
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  const day = Math.floor(h / 24);
  if (day === 1) return 'Yesterday';
  if (day < 7) return day + 'd ago';
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/* ==================== Storage ==================== */
const STORE_KEY = 'ben.chats.v1';
const PREFS_KEY = 'ben.prefs.v1';

// One-time migration from the old 'applechat.*' keys
(function migrate() {
  if (!localStorage.getItem(STORE_KEY) && localStorage.getItem('applechat.chats.v1')) {
    localStorage.setItem(STORE_KEY, localStorage.getItem('applechat.chats.v1'));
  }
  if (!localStorage.getItem(PREFS_KEY) && localStorage.getItem('applechat.prefs.v1')) {
    localStorage.setItem(PREFS_KEY, localStorage.getItem('applechat.prefs.v1'));
  }
  if (!localStorage.getItem('ben.active') && localStorage.getItem('applechat.active')) {
    localStorage.setItem('ben.active', localStorage.getItem('applechat.active'));
  }
})();

const store = {
  load() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || { chats: [] }; }
    catch { return { chats: [] }; }
  },
  save(data) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); }
    catch (e) { toast('Storage is full — delete some chats'); }
  },
};

const prefs = {
  model: 'gemini-3.5-flash',
  thinking: false,
  theme: null,
  imgSize: 1024,
  ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}'),
};
const savePrefs = () => localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));

let db = store.load();
let activeId = localStorage.getItem('ben.active') || null;

const persist = () => {
  store.save(db);
  if (activeId) localStorage.setItem('ben.active', activeId);
  else localStorage.removeItem('ben.active');
};

/* ==================== State ==================== */
let models = [];
let streaming = false;      // fetch in flight
let stopFlag = false;       // user pressed stop
let controller = null;      // AbortController
let animating = false;      // rAF smooth-render loop running
let loopToken = 0;          // invalidates stale paint loops
let pendingText = '';       // text waiting to be painted
let paintedText = '';       // text currently painted
let imageBusy = false;      // image generation in flight
let inFlightImage = null;   // the assistant msg object whose image is currently rendering
let imageMode = false;      // composer is describing an image

/* ==================== Sidebar toggle ==================== */
function applySidebar() {
  const collapsed = !!prefs.sidebarCollapsed;
  document.body.classList.toggle('sidebar-collapsed', collapsed);
  els.menu.setAttribute('aria-expanded', String(!collapsed));
}
function toggleSidebar() {
  // On mobile the sidebar slides over the content; there the hamburger just
  // opens the drawer (it auto-closes on selection), so collapsed-state only
  // really applies to desktop — but toggling still works everywhere.
  prefs.sidebarCollapsed = !document.body.classList.contains('sidebar-collapsed');
  savePrefs();
  applySidebar();
}

/* ==================== Elements ==================== */
const els = {
  chatList: $('#chatList'),
  search: $('#searchChats'),
  newChat: $('#newChatBtn'),
  menu: $('#menuBtn'),
  sidebarClose: $('#sidebarCloseBtn'),
  scrim: $('#scrim'),
  messages: $('#messages'),
  welcome: $('#welcome'),
  title: $('#chatTitle'),
  exportBtn: $('#exportBtn'),
  deleteBtn: $('#deleteBtn'),
  themeBtn: $('#themeBtn'),
  themeLabel: $('#themeLabel'),
  composer: $('#composer'),
  input: $('#input'),
  sendBtn: $('#sendBtn'),
  imgBtn: $('#imgBtn'),
  modelBtn: $('#modelBtn'),
  modelLabel: $('#modelLabel'),
  thinkingBtn: $('#thinkingBtn'),
  suggestions: $('#suggestions'),
  reasoningPanel: $('#reasoningPanel'),
  reasoningToggle: $('#reasoningToggle'),
  reasoningBody: $('#reasoningBody'),
  modelOverlay: $('#modelOverlay'),
  modelCloseBtn: $('#modelCloseBtn'),
  modelList: $('#modelList'),
  sizeBtn: $('#sizeBtn'),
  sizeLabel: $('#sizeLabel'),
  sizeOverlay: $('#sizeOverlay'),
  sizeCloseBtn: $('#sizeCloseBtn'),
  sizeList: $('#sizeList'),
  confirmOverlay: $('#confirmOverlay'),
  confirmTitle: $('#confirmTitle'),
  confirmMsg: $('#confirmMsg'),
  confirmOk: $('#confirmOk'),
  confirmCancel: $('#confirmCancel'),
  toasts: $('#toasts'),
};

/* ==================== Markdown (tiny, safe) ==================== */
function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const COPY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2.5"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
const REROLL_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>';
const CHECK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4 10-10"/></svg>';
const WRAP_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16M4 12h12a3 3 0 0 1 0 6h-3m0 0 2-2m-2 2 2 2"/><path d="M4 19h4"/></svg>';

function inlineMd(s) {
  return s
    .replace(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g, '<a class="img-link" href="$2" target="_blank" rel="noopener noreferrer" title="Open image"><img src="$2" alt="$1" loading="lazy"><span class="img-open" aria-hidden="true">↗</span></a>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/`([^`]+)`/g, '<code class="cmd" title="Click to copy">$1</code>')
    .replace(/\*\*\*([^*\n]+)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(>])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/(^|[\s(>])_([^_\n]+)_(?=[\s.,!?;:)<]|$)/g, '$1<em>$2</em>')
    .replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
}

/* ---- Zero-dependency syntax highlighting (Xcode-inspired palette) ---- */
function unescapeHtml(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

// rules: [[className, RegExpLiteral]] — tried in order at each position (sticky)
function makeTokenizer(rules, flags) {
  const regs = rules.map(([cls, re]) => [cls, new RegExp(re.source, (flags || '') + 'y')]);
  return function (raw) {
    let out = '';
    let i = 0;
    while (i < raw.length) {
      let matched = false;
      for (const [cls, re] of regs) {
        re.lastIndex = i;
        const m = re.exec(raw);
        if (m && m[0].length) {
          out += '<span class="tok-' + cls + '">' + escapeHtml(m[0]) + '</span>';
          i += m[0].length;
          matched = true;
          break;
        }
      }
      if (!matched) { out += escapeHtml(raw[i]); i++; }
    }
    return out;
  };
}

const HL_LANGS = {
  clike: {
    langs: ['js', 'jsx', 'ts', 'tsx', 'javascript', 'typescript', 'java', 'c', 'cpp', 'c++', 'cs', 'csharp', 'go', 'rust', 'rs', 'swift', 'kt', 'kotlin', 'php', 'dart', 'scala'],
    rules: [
      ['comment', /\/\/[^\n]*|\/\*[\s\S]*?\*\//],
      ['string', /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\[\s\S])*`/],
      ['number', /\b0[xX][\da-fA-F]+\b|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/],
      ['keyword', /\b(?:const|let|var|function|return|if|else|for|while|do|switch|case|default|break|continue|new|delete|this|typeof|instanceof|in|of|class|extends|super|import|export|from|as|async|await|yield|try|catch|finally|throw|static|public|private|protected|interface|type|enum|implements|namespace|package|null|undefined|true|false|void|struct|impl|fn|mut|pub|use|match|defer|go|chan|func|val|when|data|object|operator)\b/],
      ['func', /[A-Za-z_$][\w$]*(?=\s*\()/],
    ],
  },
  python: {
    langs: ['python', 'py', 'py3'],
    rules: [
      ['comment', /#[^\n]*/],
      ['string', /[fFrRbBuU]{0,2}(?:"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')/],
      ['number', /\b0[bB][01]+\b|\b0[oO][0-7]+\b|\b0[xX][\da-fA-F]+\b|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/],
      ['keyword', /\b(?:def|class|return|if|elif|else|for|while|break|continue|import|from|as|with|try|except|finally|raise|lambda|yield|global|nonlocal|pass|assert|del|async|await|and|or|not|in|is|None|True|False|self|match|case)\b/],
      ['func', /[A-Za-z_]\w*(?=\s*\()/],
    ],
  },
  json: {
    langs: ['json', 'jsonc', 'json5'],
    rules: [
      ['key', /"(?:[^"\\\n]|\\.)*"(?=\s*:)/],
      ['string', /"(?:[^"\\\n]|\\.)*"/],
      ['number', /-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/],
      ['keyword', /\b(?:true|false|null)\b/],
    ],
  },
  css: {
    langs: ['css', 'scss', 'less'],
    rules: [
      ['comment', /\/\*[\s\S]*?\*\//],
      ['atrule', /@[\w-]+/],
      ['string', /"[^"\n]*"|'[^'\n]*'/],
      ['prop', /--[\w-]+|[-a-zA-Z]+(?=\s*:)/],
      ['number', /#[\da-fA-F]{3,8}\b|\b\d+(?:\.\d+)?(?:px|em|rem|vh|vw|vmin|vmax|%|s|ms|deg|fr|ch|pt)?\b/],
      ['func', /[a-zA-Z-]+(?=\()/],
    ],
  },
  markup: {
    langs: ['html', 'xml', 'svg', 'vue', 'svelte'],
    rules: [
      ['comment', /<!--[\s\S]*?-->/],
      ['string', /"[^"]*"|'[^']*'/],
      ['tag', /<\/?[a-zA-Z][\w:-]*|\/?>/],
      ['attr', /[a-zA-Z_:][\w:.-]*(?=\s*=)/],
    ],
  },
  bash: {
    langs: ['bash', 'sh', 'shell', 'zsh', 'console'],
    rules: [
      ['comment', /#[^\n]*/],
      ['string', /"(?:[^"\\]|\\.)*"|'[^']*'/],
      ['variable', /\$\{[^}\n]*\}|\$\w+/],
      ['keyword', /\b(?:if|then|else|elif|fi|for|while|until|do|done|case|esac|in|function|return|exit|export|local|echo|cd|source|alias|set|unset|read|shift|trap|eval|exec)\b/],
      ['func', /[A-Za-z_][\w-]*(?=\s*\()/],
    ],
  },
  sql: {
    langs: ['sql'],
    flags: 'i',
    rules: [
      ['comment', /--[^\n]*|\/\*[\s\S]*?\*\//],
      ['string', /'(?:[^'\\]|\\.|'')*'|"(?:[^"\\]|\\.)*"/],
      ['number', /\b\d+(?:\.\d+)?\b/],
      ['keyword', /\b(?:select|from|where|insert|into|values|update|set|delete|create|table|database|index|view|drop|alter|add|join|inner|left|right|full|outer|on|group|by|order|having|limit|offset|as|and|or|not|null|is|in|between|like|distinct|primary|key|foreign|references|default|unique|union|all|exists|case|when|then|else|end|begin|commit|rollback|with|returning|asc|desc|count|sum|avg|min|max|cast|int|integer|text|varchar|boolean|timestamp|date)\b/],
      ['func', /[A-Za-z_]\w*(?=\s*\()/],
    ],
  },
};

const HL_TOKENIZERS = {};
function tokenizerFor(lang) {
  const l = (lang || '').toLowerCase().trim();
  if (!l) return null;
  if (l in HL_TOKENIZERS) return HL_TOKENIZERS[l];
  let tk = null;
  for (const fam of Object.values(HL_LANGS)) {
    if (fam.langs.includes(l)) { tk = makeTokenizer(fam.rules, fam.flags); break; }
  }
  HL_TOKENIZERS[l] = tk;
  return tk;
}

function highlightCode(lang, raw) {
  const tk = tokenizerFor(lang);
  return tk ? tk(raw) : escapeHtml(raw);
}

function codeBlockHtml(lang, code) {
  const langLabel = lang || 'text';
  return '<div class="code-block">' +
    '<div class="code-head">' +
      '<span class="traffic" aria-hidden="true"><i></i><i></i><i></i></span>' +
      '<span class="code-lang-name">' + langLabel + '</span>' +
      '<span class="code-actions">' +
        '<button class="code-btn code-wrap-btn" type="button" title="Toggle word wrap">' + WRAP_ICON + '<span>Wrap</span></button>' +
        '<button class="code-btn code-copy" type="button" title="Copy code">' + COPY_ICON + '<span>Copy</span></button>' +
      '</span>' +
    '</div>' +
    '<pre><code>' + highlightCode(langLabel, unescapeHtml(code)) + '</code></pre>' +
  '</div>';
}

// Keep the streaming caret inline at the end of the last text element
function withCaret(html) {
  const m = html.match(/(<\/p>|<\/li>|<\/h[1-4]>|<\/em>|<\/strong>|<\/del>|<\/blockquote>|<\/code><\/pre><\/div>)$/);
  if (m) return html.slice(0, -m[1].length) + '<span class="caret"></span>' + m[1];
  return html + '<span class="caret"></span>';
}

function renderMarkdown(src) {
  const lines = escapeHtml(src).split('\n');
  let html = '';
  let i = 0;

  const listStart = (l) => l.match(/^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/);

  const taskItem = (t) => {
    const m = t.match(/^\[([ xX])\]\s+(.*)$/);
    if (!m) return inlineMd(t);
    return '<span class="task' + (m[1] === ' ' ? '' : ' done') + '"><span class="box"></span><span>' + inlineMd(m[2]) + '</span></span>';
  };

  const parseList = () => {
    if (i >= lines.length) return;
    const base = lines[i].match(/^\s*/)[0].length;
    const items = [];
    while (i < lines.length) {
      const m = listStart(lines[i]);
      if (!m || m[1].length < base) break;
      items.push({ indent: m[1].length - base, ordered: /^\s*\d+[.)]/.test(lines[i]), text: m[2] });
      i++;
    }
    const build = (start, indent) => {
      let out = '<' + (items[start].ordered ? 'ol' : 'ul') + '>';
      let k = start;
      while (k < items.length && items[k].indent >= indent) {
        if (items[k].indent > indent) {
          const sub = build(k, items[k].indent); // nested list goes inside the previous <li>
          out = out.replace(/<\/li>$/, sub.html + '</li>');
          k = sub.next;
        } else {
          out += '<li>' + taskItem(items[k].text) + '</li>';
          k++;
        }
      }
      return { html: out + '</' + (items[start].ordered ? 'ol' : 'ul') + '>', next: k };
    };
    html += build(0, 0).html;
  };

  while (i < lines.length) {
    const line = lines[i];
    let m;

    // Fenced code (unclosed fence while streaming still renders partial code)
    if (/^```/.test(line)) {
      const lang = line.replace(/^```/, '').trim();
      i++;
      const buf = [];
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
      if (i < lines.length) i++; // closing fence
      html += codeBlockHtml(lang, buf.join('\n'));
      continue;
    }

    if ((m = line.match(/^(#{1,4})\s+(.*)$/))) {
      html += '<h' + m[1].length + '>' + inlineMd(m[2]) + '</h' + m[1].length + '>';
      i++; continue;
    }

    if (/^\s*(?:[-*_]\s*){3,}$/.test(line)) { html += '<hr>'; i++; continue; }

    // '>' arrives pre-escaped as '&gt;' by escapeHtml
    if (/^\s*&gt;\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*&gt;\s?/.test(lines[i])) { buf.push(lines[i].replace(/^\s*&gt;\s?/, '')); i++; }
      html += '<blockquote>' + inlineMd(buf.join('\n')).replace(/\n/g, '<br>') + '</blockquote>';
      continue;
    }

    // Pipe table with a |---|---| separator row
    if (
      /^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length &&
      /^\s*\|?\s*:?-{2,}[\s:|-]*$/.test(lines[i + 1]) && lines[i + 1].includes('|')
    ) {
      const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(cells(lines[i])); i++; }
      html += '<table><thead><tr>' + head.map((h) => '<th>' + inlineMd(h) + '</th>').join('') + '</tr></thead><tbody>' +
        rows.map((r) => '<tr>' + r.map((c) => '<td>' + inlineMd(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
      continue;
    }

    // Copyable shell command line ('$' prefix) — often used in step-by-step guides
    if (/^\s*\$\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*\$\s?/.test(lines[i])) { buf.push(lines[i].replace(/^\s*\$\s?/, '').trim()); i++; }
      html += buf.map((c) =>
        '<div class="cmd-line">' +
        '<span class="cmd-prompt" aria-hidden="true">$</span>' +
        '<code class="cmd-text">' + c + '</code>' +
        '<button class="cmd-copy code-btn" type="button" title="Copy command">' + COPY_ICON + '<span class="cmd-copy-label">Copy</span></button>' +
        '</div>'
      ).join('');
      continue;
    }

    if (listStart(line)) { parseList(); continue; }
    if (/^\s*$/.test(line)) { i++; continue; }

    // Paragraph: gather until a blank line or the start of another block
    const buf = [line];
    i++;
    while (i < lines.length) {
      const nxt = lines[i];
      if (
        !nxt.trim() || /^```/.test(nxt) || /^(#{1,4})\s+/.test(nxt) ||
        /^\s*&gt;/.test(nxt) || listStart(nxt) ||
        /^\s*(?:[-*_]\s*){3,}$/.test(nxt) || /^\s*\|/.test(nxt)
      ) break;
      buf.push(nxt);
      i++;
    }
    html += '<p>' + inlineMd(buf.join('\n')).replace(/\n/g, '<br>') + '</p>';
  }
  return html;
}

/* ---- <FollowUp label="…" query="…"/> tags the model sometimes appends —
   stripped from display and turned into tappable chips ---- */
const FOLLOWUP_TAG_RE = /<FollowUp\b[^>]*?\/>\s*/gi;

// Pull { label, query } suggestions out of raw text (order preserved).
function extractFollowUps(text) {
  const out = [];
  const tagRe = /<FollowUp\b([^>]*?)(?:\/>|>[\s\S]*?<\/FollowUp\s*>)/gi;
  let m;
  while ((m = tagRe.exec(text))) {
    const attrs = m[1];
    const get = (name) => {
      const am = attrs.match(new RegExp(name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\'|([^\\s"\'>]+))', 'i'));
      return am ? (am[2] !== undefined ? am[2] : am[3] !== undefined ? am[3] : am[4] || '') : '';
    };
    const query = get('query').trim();
    if (query) out.push({ label: get('label').trim() || query, query });
  }
  return out.slice(0, 3);
}

function stripFollowUps(text) {
  return text.replace(/<FollowUp\b[^>]*(?:\/>|>[\s\S]*?<\/FollowUp\s*>)/gi, '').trimEnd();
}

// Fallback chips derived from the conversation when the model didn't emit any.
function defaultFollowUps(chat) {
  const msgs = (chat && chat.messages) || [];
  const lastUser = [...msgs].reverse().find((m) => m.role === 'user');
  const t = lastUser ? lastUser.content.trim().replace(/\s+/g, ' ') : '';
  if (!t) return [];
  return [
    { label: 'Tell me more', query: 'Tell me more about that.' },
    { label: 'Explain it simpler', query: 'Explain that in simpler terms.' },
  ];
}

function plainText(md) {
  const div = document.createElement('div');
  div.innerHTML = renderMarkdown(stripFollowUps(md));
  return div.textContent || '';
}

/* ==================== Toasts ==================== */
function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  els.toasts.appendChild(t);
  setTimeout(() => { t.classList.add('hide'); setTimeout(() => t.remove(), 250); }, 2200);
}

/* ==================== Welcome suggestions ==================== */
// A fresh random mix of starter prompts on every load/refresh.
const SUGGESTION_POOL = [
  { label: 'Explain quantum computing simply', prompt: "Explain quantum computing like I'm five, with one fun analogy." },
  { label: 'Write a poem about rain', prompt: 'Write a short poem about rain on a tin roof.' },
  { label: 'Weekend JS project ideas', prompt: 'Give me 3 ideas for a weekend side project in JavaScript.' },
  { label: 'Draft a polite email', prompt: 'Draft a polite email asking for a deadline extension.' },
  { label: 'Plan a 3-day trip', prompt: 'Plan a relaxed 3-day itinerary for Lisbon on a modest budget.' },
  { label: 'Debug my code', prompt: 'My JavaScript function returns undefined. How do I debug it step by step?' },
  { label: 'Explain AI vs ML', prompt: 'Explain the difference between AI, machine learning, and deep learning with examples.' },
  { label: 'Make a study plan', prompt: 'Create a 2-week study plan to learn the basics of Python.' },
  { label: 'Fun fact deep-dive', prompt: 'Tell me a surprising fun fact, then go one level deeper.' },
  { label: 'Name my project', prompt: 'Suggest 10 memorable names for a personal coding project.' },
  { label: 'Write a haiku', prompt: 'Write a haiku about late-night coding sessions.' },
  { label: 'Improve my writing', prompt: 'Rewrite this sentence to sound clearer: "We are in receipt of your inquiry."' },
  { label: 'Cook dinner tonight', prompt: 'I have eggs, rice, and vegetables. Suggest a quick dinner recipe.' },
  { label: 'Workout in 20 min', prompt: 'Design a 20-minute no-equipment home workout.' },
  { label: 'Learn a magic trick', prompt: 'Teach me an easy card trick I can show a friend.' },
  { label: 'Riddle me this', prompt: 'Give me a tricky riddle and let me guess before revealing the answer.' },
];

function renderSuggestions() {
  const count = 4; // matches the 2×2 grid
  const pool = SUGGESTION_POOL.slice();
  // Fisher–Yates shuffle, then take the first `count`
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
  }
  els.suggestions.innerHTML = '';
  for (const s of pool.slice(0, count)) {
    const btn = document.createElement('button');
    btn.className = 'suggestion';
    btn.dataset.prompt = s.prompt;
    btn.textContent = s.label;
    els.suggestions.appendChild(btn);
  }
}

els.suggestions.addEventListener('click', (e) => {
  const btn = e.target.closest('.suggestion');
  if (!btn) return;
  els.input.value = btn.dataset.prompt;
  els.composer.requestSubmit();
});

/* ==================== Theme ==================== */
function applyTheme() {
  const sysDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = prefs.theme || (sysDark ? 'dark' : 'light');
  document.documentElement.dataset.theme = theme;
  els.themeLabel.textContent = theme === 'dark' ? 'Dark' : 'Light';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === 'dark' ? '#131315' : '#f5f5f7';
}
els.themeBtn.addEventListener('click', () => {
  const cur = document.documentElement.dataset.theme;
  prefs.theme = cur === 'dark' ? 'light' : 'dark';
  savePrefs();
  applyTheme();
});
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (!prefs.theme) applyTheme(); });

/* ==================== Chat store ops ==================== */
function getChat(id) { return db.chats.find((c) => c.id === id); }
function activeChat() { return getChat(activeId); }

function createChat() {
  const chat = { id: uid(), title: 'New Chat', createdAt: Date.now(), updatedAt: Date.now(), model: prefs.model, messages: [] };
  db.chats.unshift(chat);
  activeId = chat.id;
  persist();
  renderList();
  renderChat();
  closeSidebar();
  if (imageMode) setImageMode(false); // fresh chat starts in text mode
  els.input.focus();
  return chat;
}

function deleteChat(id) {
  const idx = db.chats.findIndex((c) => c.id === id);
  if (idx === -1) return;
  db.chats.splice(idx, 1);
  if (activeId === id) {
    activeId = db.chats[0] ? db.chats[0].id : null;
    if (imageMode) setImageMode(false); // landed in a different chat — drop stale image intent
  }
  persist();
  renderList();
  renderChat();
}

function renameChat(id, title) {
  const chat = getChat(id);
  if (!chat) return;
  chat.title = title.trim() || chat.title;
  chat.updatedAt = Date.now();
  persist();
  renderList();
  renderChat();
}

function touchChat(chat) {
  chat.updatedAt = Date.now();
  persist();
}

/* ==================== Sidebar rendering ==================== */
function chatGroups() {
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const g = { Today: [], Yesterday: [], 'Previous 7 Days': [], Older: [] };
  for (const c of [...db.chats].sort((a, b) => b.updatedAt - a.updatedAt)) {
    const t = c.updatedAt;
    if (t >= startToday) g.Today.push(c);
    else if (t >= startToday - 864e5) g.Yesterday.push(c);
    else if (t >= startToday - 7 * 864e5) g['Previous 7 Days'].push(c);
    else g.Older.push(c);
  }
  return g;
}

function renderList() {
  const q = els.search.value.trim().toLowerCase();
  els.chatList.innerHTML = '';
  const groups = chatGroups();
  let shown = 0;

  for (const [label, chats] of Object.entries(groups)) {
    const filtered = q ? chats.filter((c) => c.title.toLowerCase().includes(q)) : chats;
    if (!filtered.length) continue;
    shown += filtered.length;

    const lab = document.createElement('div');
    lab.className = 'list-label';
    lab.innerHTML = '<span>' + label + '</span><span>' + filtered.length + '</span>';
    els.chatList.appendChild(lab);

    for (const c of filtered) {
      const item = document.createElement('div');
      item.className = 'chat-item' + (c.id === activeId ? ' active' : '');
      item.setAttribute('role', 'button');
      item.tabIndex = 0;
      const last = c.messages.length ? c.messages[c.messages.length - 1] : null;
      const sub = last ? plainText(last.content).slice(0, 60) : 'No messages yet';
      item.innerHTML =
        '<div class="ci-main"><div class="ci-title"></div><div class="ci-sub"></div></div>' +
        '<button class="icon-btn ci-del" title="Delete chat" aria-label="Delete chat">' +
        '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg></button>';
      item.querySelector('.ci-title').textContent = c.title;
      item.querySelector('.ci-sub').textContent = sub;
      item.addEventListener('click', (e) => {
        if (e.target.closest('.ci-del')) return;
        activeId = c.id;
        persist();
        renderList();
        renderChat();
        closeSidebar();
        // Image mode is per-composer intent, not per-chat: leaving the chat that
        // wanted an image shouldn't turn the next chat's messages into images.
        if (imageMode) setImageMode(false);
      });
      item.addEventListener('keydown', (e) => { if (e.key === 'Enter') item.click(); });
      item.querySelector('.ci-del').addEventListener('click', (e) => {
        e.stopPropagation();
        confirmDialog('Delete chat?', '“' + c.title + '” will be permanently removed from this device.', () => deleteChat(c.id));
      });
      els.chatList.appendChild(item);
    }
  }

  if (!shown) {
    const empty = document.createElement('div');
    empty.className = 'empty-list';
    empty.textContent = q ? 'No chats match your search.' : 'No chats yet — start one!';
    els.chatList.appendChild(empty);
  }
}

/* ==================== Messages rendering ==================== */
function clearNodes(container, keepFirst) {
  if (!keepFirst) { container.innerHTML = ''; return; }
  const keep = container.firstElementChild; // #welcome
  Array.from(container.children).forEach((el) => { if (el !== keep) el.remove(); });
}

function showWelcome(show) { els.welcome.style.display = show ? '' : 'none'; }

// Renders the tappable follow-up chips under the assistant's latest reply.
function buildFollowUps(list) {
  const wrap = document.createElement('div');
  wrap.className = 'followups';
  for (const item of list) {
    if (!item || !item.query) continue;
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'followup-chip';
    chip.title = item.query;
    chip.textContent = item.label;
    chip.addEventListener('click', () => {
      if (streaming) { toast('Wait for the current reply to finish'); return; }
      els.input.value = item.query;
      els.composer.requestSubmit();
    });
    wrap.appendChild(chip);
  }
  return wrap.children.length ? wrap : null;
}

function buildMessageEl(msg, idx, chat) {
  idx = typeof idx === 'number' ? idx : -1;
  const wrap = document.createElement('div');
  wrap.className = 'msg ' + (msg.role === 'user' ? 'user' : 'bot');

  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.innerHTML = msg.role === 'user'
    ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 5-5.5 8-5.5s6.5 1.5 8 5.5"/></svg>'
    : '<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><rect x="1" y="1" width="22" height="22" rx="7" fill="url(#ben-grad)"/><text x="12" y="16.5" text-anchor="middle" font-size="13" font-weight="700" fill="#fff">B</text></svg>';

  const col = document.createElement('div');
  col.className = 'bubble-col';

  // Reasoning (thinking) block for bot messages that have one
  if (msg.role === 'assistant' && msg.reasoning && msg.reasoning.trim()) {
    const think = document.createElement('div');
    think.className = 'think-block open';
    think.innerHTML =
      '<button class="think-head" type="button"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 1 3.6 10.8c-.6.5-.9 1-.9 1.7v.5h-5.4v-.5c0-.7-.3-1.2-.9-1.7A6 6 0 0 1 12 3z"/><path d="M10 19h4"/></svg><span>Thought process</span><svg class="chev" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></button>' +
      '<div class="think-body"></div>';
    think.querySelector('.think-body').textContent = msg.reasoning;
    think.querySelector('.think-head').addEventListener('click', () => think.classList.toggle('open'));
    col.appendChild(think);
  }

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  if (msg.role === 'user') {
    bubble.textContent = msg.content;
  } else {
    const md = document.createElement('div');
    md.className = 'md';
    // A persisted imgLoading:true only means the tab was closed mid-render —
    // never restore the spinner on reload (waitForImage would have to re-run).
    if (msg.img) md.innerHTML = imageMd(msg.img, !!msg.imgLoading && inFlightImage === msg);
    else if (msg.genInProgress || msg.genError) md.innerHTML = buildGenCard(msg);
    else md.innerHTML = renderMarkdown(msg.content || '');
    bubble.appendChild(md);
  }
  col.appendChild(bubble);

  // Follow-up suggestion chips (assistant text messages)
  if (msg.role === 'assistant' && !msg.img && !msg.genInProgress && !msg.genError &&
      typeof idx === 'number' && idx >= 0 && chat && chat.messages && chat.messages[idx] === msg) {
    let followUps = extractFollowUps(msg.content || '');
    if (!followUps.length && msg.followUps && msg.followUps.length) followUps = msg.followUps;
    if (!followUps.length && idx === chat.messages.length - 1) followUps = defaultFollowUps(chat);
    if (followUps.length) col.appendChild(buildFollowUps(followUps));
  }

  // Copy (+ re-roll for generated images)
  const tools = document.createElement('div');
  tools.className = 'msg-tools';
  const copyBtn = document.createElement('button');
  copyBtn.className = 'icon-btn copy-btn';
  copyBtn.title = msg.img ? 'Copy prompt' : 'Copy';
  copyBtn.setAttribute('aria-label', msg.img ? 'Copy prompt' : 'Copy message');
  copyBtn.innerHTML = COPY_ICON;
  copyBtn.addEventListener('click', () => {
    const text = msg.img ? (promptForImage(idx) || msg.content) : msg.content;
    navigator.clipboard.writeText(text).then(() => {
      copyBtn.classList.add('copied');
      setTimeout(() => copyBtn.classList.remove('copied'), 1200);
    });
  });
  tools.appendChild(copyBtn);
  // Response time (right of Copy) on finished assistant text replies
  if (msg.role === 'assistant' && !msg.img && !msg.genInProgress && !msg.genError && msg.responseMs > 0) {
    tools.appendChild(buildTimingLabel(msg.responseMs));
  }
  if (msg.img && idx >= 0) {
    const rerollBtn = document.createElement('button');
    rerollBtn.className = 'icon-btn reroll-btn';
    rerollBtn.title = 'Generate a new variation';
    rerollBtn.setAttribute('aria-label', 'Generate a new variation');
    rerollBtn.innerHTML = REROLL_ICON;
    rerollBtn.addEventListener('click', () => rerollImage(msg, idx, rerollBtn));
    tools.appendChild(rerollBtn);
  }
  col.appendChild(tools);

  wrap.appendChild(avatar);
  wrap.appendChild(col);
  return wrap;
}

function renderChat() {
  clearNodes(els.messages, true); // keep #welcome node
  const chat = activeChat();

  if (!chat || !chat.messages.length) {
    showWelcome(true);
    els.title.textContent = chat ? chat.title : 'BEN';
    document.title = 'BEN';
    return;
  }
  showWelcome(false);
  els.title.textContent = chat.title;
  document.title = chat.title + ' — BEN';

  chat.messages.forEach((m, i) => els.messages.appendChild(buildMessageEl(m, i, chat)));
  bindCodeCopy(els.messages);
  scrollToBottom(false);
}

function bindCodeCopy(root) {
  root.querySelectorAll('.code-block:not([data-bound])').forEach((block) => {
    block.dataset.bound = '1';
    const code = block.querySelector('code');
    const copyBtn = block.querySelector('.code-copy');
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(code.textContent).then(() => {
        copyBtn.classList.add('copied');
        copyBtn.innerHTML = CHECK_ICON + '<span>Copied</span>';
        setTimeout(() => {
          copyBtn.classList.remove('copied');
          copyBtn.innerHTML = COPY_ICON + '<span>Copy</span>';
        }, 1400);
      });
    });
    block.querySelector('.code-wrap-btn').addEventListener('click', () => block.classList.toggle('wrap'));
  });
}

function copyToClipboard(text) {
  return navigator.clipboard.writeText(text);
}

// Feedback helper for inline chips and command-line copy buttons
function flashCopied(el) {
  if (!el || el.dataset.flashing) return;
  el.dataset.flashing = '1';
  el.classList.add('copied');
  const label = el.querySelector('.cmd-copy-label');
  if (label) label.textContent = 'Copied';
  setTimeout(() => {
    delete el.dataset.flashing;
    el.classList.remove('copied');
    if (label) label.textContent = 'Copy';
  }, 1200);
}

// Delegated: inline command chips + shell ($) command lines are click-to-copy
els.messages.addEventListener('click', (e) => {
  const chip = e.target.closest('code.cmd');
  if (chip) {
    copyToClipboard(chip.textContent.trim()).then(() => flashCopied(chip)).catch(() => {});
    return;
  }
  const line = e.target.closest('.cmd-line');
  if (line) {
    copyToClipboard(line.querySelector('.cmd-text').textContent.trim()).then(() => flashCopied(line.querySelector('.cmd-copy'))).catch(() => {});
  }
});

function scrollToBottom(smooth) {
  els.messages.scrollTo({ top: els.messages.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
}

/* ==================== Streaming ==================== */
function setStreamingUI(on) {
  streaming = on;
  els.sendBtn.classList.toggle('streaming', on);
  els.sendBtn.title = on ? 'Stop' : 'Send';
  els.input.disabled = false; // keep input editable; only button changes
}

function makeBotBubble() {
  const msg = { role: 'assistant', content: '', reasoning: '' };
  const el = buildMessageEl(msg);
  const md = el.querySelector('.md');
  md.innerHTML = '<span class="caret"></span>';
  els.messages.appendChild(el);
  scrollToBottom(true);
  return { msg, el, md };
}

// rAF loop: paints pendingText toward paintedText at a comfortable rate for buttery streaming
function startAnimLoop(md, chat, botMsg) {
  const myToken = ++loopToken;
  animating = true;
  const tick = () => {
    if (myToken !== loopToken) return; // superseded by a newer loop
    if (paintedText !== pendingText) {
      const diff = pendingText.length - paintedText.length;
      const step = Math.max(2, Math.min(48, Math.ceil(diff / 8))); // catch up adaptively
      paintedText = pendingText.slice(0, paintedText.length + step);
      // Hide FollowUp tags while streaming: strip complete ones, clip partial ones.
      let visible = paintedText.replace(/<FollowUp\b[^>]*(?:\/>|>[\s\S]*?<\/FollowUp\s*>)/gi, '');
      const partial = visible.search(/<F(?:o(?:l(?:l(?:o(?:w(?:U(?:p)?)?)?)?)?)?)?$/i);
      if (partial >= 0) visible = visible.slice(0, partial);
      md.innerHTML = withCaret(renderMarkdown(visible));
      bindCodeCopy(md);
      const nearBottom = els.messages.scrollHeight - els.messages.scrollTop - els.messages.clientHeight < 120;
      if (nearBottom) scrollToBottom(false);
    }
    if (streaming || paintedText !== pendingText) {
      requestAnimationFrame(tick);
    } else {
      animating = false;
      finalizeBot(md, chat, botMsg);
    }
  };
  requestAnimationFrame(tick);
}

function finalizeBot(md, chat, botMsg) {
  // Peel off any <FollowUp …/> tags the model appended; keep them as chips.
  const tags = extractFollowUps(botMsg.content || '');
  const clean = stripFollowUps(botMsg.content || '');
  if (tags.length) {
    botMsg.content = clean;
    botMsg.followUps = tags;
    pendingText = clean;
    paintedText = clean;
  }

  md.innerHTML = renderMarkdown(botMsg.content);
  bindCodeCopy(md);
  if (!botMsg.content.trim() && !botMsg.reasoning.trim()) {
    botMsg.content = '⚠️ The assistant returned an empty response. Try again.';
    md.innerHTML = '<p>' + botMsg.content + '</p>';
  } else if (/^https?:\/\/\S+\.(png|jpe?g|gif|webp)(\?\S*)?$/i.test(botMsg.content.trim())) {
    botMsg.content = '⚠️ The upstream returned an image instead of text. Try again in a moment.';
    md.innerHTML = '<p>' + botMsg.content + '</p>';
  }
  if (botMsg.followUps && botMsg.followUps.length) {
    const col = md.parentElement; // .bubble-col
    const old = col.querySelector('.followups');
    if (old) old.remove();
    const chips = buildFollowUps(botMsg.followUps);
    if (chips) col.appendChild(chips);
  }
  // Response time appears next to Copy as soon as the reply is fully rendered.
  if (botMsg.responseMs > 0) {
    const col = md.parentElement; // .bubble-col
    const toolsRow = col && col.querySelector('.msg-tools');
    const copyBtn = toolsRow && toolsRow.querySelector('.copy-btn');
    if (toolsRow && copyBtn && !toolsRow.querySelector('.msg-time')) {
      toolsRow.insertBefore(buildTimingLabel(botMsg.responseMs), copyBtn.nextSibling);
    }
  }
  touchChat(chat);
  renderList(); // refresh sidebar preview
  scrollToBottom(false);
}

function updateReasoningPanel(text, done) {
  if (!text.trim()) { els.reasoningPanel.hidden = true; return; }
  els.reasoningPanel.hidden = false;
  els.reasoningBody.textContent = text;
  if (!done) els.reasoningBody.scrollTop = els.reasoningBody.scrollHeight;
}

/* ==================== Auto chat titles ==================== */
function heuristicTitle(text) {
  const t = text.trim().replace(/\s+/g, ' ');
  return t.slice(0, 40) + (t.length > 40 ? '…' : '');
}

// Ask the LLM for a short title; returns null on any failure so we fall back to heuristic.
function generateChatTitle(text) {
  const model = models.length ? models[0].id : DEFAULT_MODELS[0].id;
  return fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      max_tokens: 24,
      temperature: 0.3,
      messages: [
        { role: 'system', content: 'You craft concise chat titles. Reply with ONLY the title: 2–6 words, lowercase, no quotes, no trailing punctuation, no numbering.' },
        { role: 'user', content: text.slice(0, 500) },
      ],
    }),
  })
    .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then((j) => {
      const t = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
      const s = String(t || '').trim().replace(/^["“”]+|["“”.]+$/g, '').slice(0, 48);
      if (!s || s.length > 40 || /https?:\/\//i.test(s)) return null;
      return s;
    })
    .catch(() => null);
}

// Upgrades the placeholder title once the LLM answers (unless the user renamed manually).
function autoTitleAsync(chat, text) {
  generateChatTitle(text).then((title) => {
    const c = getChat(chat.id);
    const heuristic = heuristicTitle(text);
    if (!title || !c || (c.title !== heuristic && c.title !== 'New Chat')) return;
    c.title = title;
    c.updatedAt = Date.now();
    persist();
    if (activeId === c.id) {
      els.title.textContent = title;
      document.title = title + ' — BEN';
    }
    renderList();
  });
}

/* ==================== Image generation ==================== */
function imageMd(url, loading) {
  return '<a class="img-link' + (loading ? ' img-loading' : '') + '" href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer" title="Open image">' +
    '<img src="' + escapeHtml(url) + '" alt="Generated image"' + (loading ? '' : ' loading="lazy"') + '>' +
    '<span class="img-open" aria-hidden="true">↗</span>' +
    (loading
      ? '<span class="img-wait" role="status" aria-live="polite">' +
        '<span class="gen-spin"></span><span class="img-wait-label">Generating image…</span></span>'
      : '') +
    '</a>';
}

// Human-readable duration for the response-time label (e.g. "840ms", "3.2s", "1m 04s").
function formatDuration(ms) {
  if (ms < 1000) return Math.round(ms) + 'ms';
  if (ms < 10000) return (ms / 1000).toFixed(1) + 's';
  if (ms < 60000) return Math.round(ms / 1000) + 's';
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return m + 'm ' + String(s).padStart(2, '0') + 's';
}

// Small elapsed-time label shown next to Copy on assistant replies.
function buildTimingLabel(ms) {
  const t = document.createElement('span');
  t.className = 'msg-time';
  t.title = 'Time to generate this response';
  t.textContent = formatDuration(ms);
  return t;
}

// Resolves when the given image URL actually renders pixels (or rejects on error / timeout).
// Pollinations only starts rendering Flux when the image is first requested, so the URL
// returns instantly but the pixels can take tens of seconds — the UI must wait for load.
function waitForImage(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const timer = setTimeout(() => {
      img.src = ''; // stop the request
      reject(new Error('Timed out while generating the image'));
    }, timeoutMs || 180000);
    img.onload = () => { clearTimeout(timer); resolve(url); };
    img.onerror = () => { clearTimeout(timer); reject(new Error('Image failed to load')); };
    img.src = url;
  });
}

function buildGenCard(msg) {
  return '<div class="gen-card' + (msg.genError ? ' failed' : '') + '">' +
    '<span class="gen-spin"></span><span>' + (msg.genError || 'Generating image…') + '</span></div>';
}

function setImageBusy(on) {
  imageBusy = on;
  els.sendBtn.disabled = on;
  els.sendBtn.title = on ? 'Generating image…' : 'Send';
}

// POSTs the prompt to our proxy and resolves the Pollinations image URL.
async function requestImageUrl(prompt) {
  const res = await fetch('/api/image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, width: imageSize(), height: imageSize() }),
  });
  if (!res.ok) {
    let msgText = 'HTTP ' + res.status;
    try { const j = await res.json(); if (j.error && j.error.message) msgText = j.error.message; } catch {}
    throw new Error(msgText);
  }
  const j = await res.json();
  const url = j.url || (j.data && j.data[0] && j.data[0].url); // our proxy returns { url }
  if (!url) throw new Error('No image URL returned');
  return url;
}

// The prompt that produced the image message at idx = nearest preceding user message.
function promptForImage(idx) {
  const chat = activeChat();
  if (!chat || typeof idx !== 'number' || idx < 0) return '';
  for (let i = Math.min(idx, chat.messages.length - 1); i >= 0; i--) {
    const m = chat.messages[i];
    if (m && m.role === 'user') return m.content;
  }
  return '';
}

// Re-roll: generate a fresh variation of an existing image's prompt (new seed per request).
async function rerollImage(msg, idx, sourceBtn) {
  if (imageBusy) { toast('Already generating an image…'); return; }
  const chat = activeChat();
  if (!chat || chat.messages[idx] !== msg) { toast('Cannot re-roll this image'); return; }
  const prompt = promptForImage(idx);
  if (!prompt) { toast('Original prompt not found'); return; }

  const genCard = buildMessageEl({ role: 'assistant', content: '', genInProgress: true });
  els.messages.appendChild(genCard);
  scrollToBottom(true);

  setImageBusy(true);
  if (sourceBtn) { sourceBtn.disabled = true; sourceBtn.classList.add('busy'); }
  let botMsg = null;
  let botEl = null;
  try {
    const url = await requestImageUrl(prompt);

    // Same as generateImage: keep the "Generating image…" state until pixels arrive.
    botMsg = { role: 'assistant', content: '', img: url, imgLoading: true };
    inFlightImage = botMsg;
    botEl = buildMessageEl(botMsg, chat.messages.length, chat);
    chat.messages.push(botMsg);
    persist();
    genCard.remove();
    els.messages.appendChild(botEl);
    scrollToBottom(true);
    await waitForImage(url);

    botMsg.imgLoading = false;
    inFlightImage = null;
    persist();
    // Swap in the finished image only if its chat is still on screen (the user
    // may have switched chats while Flux was rendering — the data is persisted
    // either way and shows up when they switch back).
    if (activeId === chat.id) {
      const fresh = buildMessageEl(botMsg, chat.messages.length - 1, chat);
      if (botEl && botEl.parentNode === els.messages) els.messages.replaceChild(fresh, botEl);
      else els.messages.appendChild(fresh);
      scrollToBottom(true);
    }
    touchChat(chat);
    renderList();
    toast('New variation ready');
  } catch (err) {
    if (botMsg) { // URL arrived but the image never rendered — drop the placeholder bubble
      const i = chat.messages.indexOf(botMsg);
      if (i >= 0) chat.messages.splice(i, 1);
      if (botEl) botEl.remove();
    }
    inFlightImage = null;
    persist();
    genCard.remove();
    toast('Re-roll failed — ' + err.message);
  } finally {
    setImageBusy(false);
    if (sourceBtn) { sourceBtn.disabled = false; sourceBtn.classList.remove('busy'); }
  }
}

async function generateImage(text) {
  if (imageBusy) return;
  let chat = activeChat();
  if (!chat) chat = createChat();

  const userMsg = { role: 'user', content: text };
  chat.messages.push(userMsg);
  touchChat(chat);
  if (chat.title === 'New Chat') {
    chat.title = heuristicTitle(text);
    els.title.textContent = chat.title;
    autoTitleAsync(chat, text);
  }
  renderList();
  showWelcome(false);
  els.messages.appendChild(buildMessageEl(userMsg, chat.messages.length - 1));
  scrollToBottom(true);

  const genCard = buildMessageEl({ role: 'assistant', content: '', genInProgress: true });
  els.messages.appendChild(genCard);
  scrollToBottom(true);

  setImageBusy(true);
  let botMsg = null;
  let botEl = null;
  try {
    const url = await requestImageUrl(text);

    // Pollinations starts rendering only when the URL is first requested, so swap the
    // spinner card for a loading image bubble that keeps saying "Generating image…"
    // until the pixels actually arrive (waitForImage).
    botMsg = { role: 'assistant', content: '', img: url, imgLoading: true };
    inFlightImage = botMsg;
    botEl = buildMessageEl(botMsg, chat.messages.length, chat);
    chat.messages.push(botMsg);
    persist();
    genCard.remove();
    els.messages.appendChild(botEl);
    scrollToBottom(true);
    await waitForImage(url);

    botMsg.imgLoading = false;
    inFlightImage = null;
    persist();
    // Swap in the finished image only if its chat is still on screen (the user
    // may have switched chats while Flux was rendering — the data is persisted
    // either way and shows up when they switch back).
    if (activeId === chat.id) {
      const fresh = buildMessageEl(botMsg, chat.messages.length - 1, chat);
      if (botEl && botEl.parentNode === els.messages) els.messages.replaceChild(fresh, botEl);
      else els.messages.appendChild(fresh);
      scrollToBottom(true);
    }
    touchChat(chat);
    renderList();
    toast('Image ready');
  } catch (err) {
    if (botMsg) { // URL arrived but the image never rendered — drop the placeholder bubble
      const i = chat.messages.indexOf(botMsg);
      if (i >= 0) chat.messages.splice(i, 1);
      if (botEl) botEl.remove();
    }
    inFlightImage = null;
    const errMsg = { role: 'assistant', content: '', genError: err.message };
    chat.messages.push(errMsg);
    persist();
    genCard.remove();
    if (activeId === chat.id) { // error card belongs to its own chat's DOM
      els.messages.appendChild(buildMessageEl(errMsg));
      scrollToBottom(true);
    }
    touchChat(chat);
    renderList();
    toast('Image failed — ' + err.message);
  } finally {
    setImageBusy(false);
    // One-shot: turn image mode off after each generation so a follow-up text
    // message isn't silently turned into an image prompt (and switching chats
    // right after never carries a stale "Image" selection).
    setImageMode(false);
  }
}

function setImageMode(on) {
  imageMode = on;
  applyImageMode();
}

// Reflects imageMode onto the composer controls (split out so chat switches
// can re-sync the UI without touching the flag itself).
function applyImageMode() {
  els.imgBtn.setAttribute('aria-checked', String(imageMode));
  els.composer.classList.toggle('img-mode', imageMode);
  els.sizeBtn.hidden = !imageMode;
  els.input.placeholder = imageMode ? 'Describe an image…' : 'Message BEN…';
  els.input.setAttribute('aria-label', imageMode ? 'Describe an image' : 'Message');
}

async function sendMessage(text) {
  if (streaming) return;
  let chat = activeChat();
  if (!chat) chat = createChat();

  const userMsg = { role: 'user', content: text };
  chat.messages.push(userMsg);
  touchChat(chat);
  if (chat.title === 'New Chat') {
    chat.title = heuristicTitle(text);
    els.title.textContent = chat.title;
    autoTitleAsync(chat, text);
  }
  renderList();
  showWelcome(false);
  els.messages.appendChild(buildMessageEl(userMsg));
  scrollToBottom(true);

  const bot = makeBotBubble();
  const startedAt = Date.now(); // response timing shown next to Copy when done
  pendingText = '';
  paintedText = '';
  updateReasoningPanel('', true);

  // Build request: OpenAI-compatible payload; thinking toggle routes to a valid -thinking variant
  const model = resolveModel(prefs.model, prefs.thinking);

  const apiMessages = [{ role: 'system', content: 'You are BEN, a helpful, friendly AI assistant. Format answers with clean Markdown. Be concise but complete. When it makes sense, end your reply with 1–3 suggestions for what the user might ask next, each on its own line at the very end, in exactly this format: <FollowUp label="short chip text" query="full message to send"/> — nothing after them.' }]
    .concat(chat.messages.slice(-30).map((m) => ({ role: m.role, content: m.content })));

  controller = new AbortController();
  stopFlag = false;
  setStreamingUI(true);
  startAnimLoop(bot.el.querySelector('.md'), chat, bot.msg); // paints smoothly while the stream arrives

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, stream: true, messages: apiMessages }),
      signal: controller.signal,
    });

    if (!res.ok) {
      let msgText = 'HTTP ' + res.status;
      try { const j = await res.json(); if (j.error && j.error.message) msgText = j.error.message; } catch {}
      throw new Error(msgText);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done || stopFlag) break;
      buf += decoder.decode(value, { stream: true });

      const events = buf.split('\n\n');
      buf = events.pop(); // keep incomplete tail
      for (const ev of events) {
        for (const line of ev.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') continue;
          let json;
          try { json = JSON.parse(data); } catch { continue; }
          const delta = json.choices && json.choices[0] && json.choices[0].delta || {};
          if (delta.reasoning_content) {
            bot.msg.reasoning += delta.reasoning_content;
            updateReasoningPanel(bot.msg.reasoning, false);
          }
          if (delta.content) {
            pendingText += delta.content;
            bot.msg.content = pendingText;
          }
        }
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      pendingText += (pendingText ? '\n\n' : '') + '⚠️ ' + err.message;
      bot.msg.content = pendingText;
      toast('Request failed — ' + err.message);
    }
  } finally {
    chat.messages.push(bot.msg);
    bot.msg.responseMs = Date.now() - startedAt;
    setStreamingUI(false);
    controller = null;
    updateReasoningPanel(bot.msg.reasoning, true);
    if (stopFlag && !pendingText) {
      bot.msg.content = '⏹ Stopped.';
      pendingText = bot.msg.content;
    }
    // The paint loop (already running) flushes remaining text, then finalizes.
    els.input.focus();
  }
}

/* ==================== Model picker ==================== */
function isThinkingModel(id) { return id.includes('thinking'); }

/* Model metadata — icons + human descriptions */
const MODEL_META = {
  /* Gemini models */
  'gemini-3.5-flash': { icon: 'chat', desc: 'All-around model' },
  'gemini-3.5-flash-thinking': { icon: 'bolt', desc: 'Deep thinking mode, longest output' },
  'gemini-3.5-flash-thinking-lite': { icon: 'bolt', desc: 'Dynamic thinking with adaptive depth' },
  'gemini-3.7-flash': { icon: 'sparkle', desc: 'Latest all-around model' },
  'gemini-3.1-pro': { icon: 'crown', desc: 'Pro model' },
  'gemini-flash-lite': { icon: 'bolt', desc: 'Lightweight fast model' },
  'gemini-auto': { icon: 'chat', desc: 'Auto model selection' },
  'gemini-3.6-flash': { icon: 'chat', desc: 'All-around model' },
  'gemini-3.1-pro-enhanced': { icon: 'crown', desc: 'Pro with enhanced output' },
};

const MODEL_ICONS = {
  chat: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="10" r="3.2" fill="currentColor" stroke="none"/><circle cx="16" cy="14" r="4.4" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  crown: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 18.5h14M5.5 10l2 3.2 1.2 3.2 2 3.2 1.2 3.2 2 3.2 1.2 3.2 2 3.2"/></svg>',
  bolt: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3l-1.4 4-3.4 2.4-1.8 3.6-2.4 2.8-3.4 3.6-2 2.4-2.6 2"/></svg>',
  omni: '<svg viewBox="0 0 24 24" width="18" height="18"><circle cx="12" cy="12" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none"/></svg>',
  sparkle: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4l2.5 3.2 3.2 2.5 4.2.7 4 0-2.7 2.24-4.5.8-5-3.2-2.24-4.5-.8 5z"/><path d="M12 3v18M12 3h18"/></svg>',
};

/* Image sizes — square, multiples of 256 within Pollinations' supported range */
const SIZE_OPTIONS = [512, 768, 1024, 1280, 1536];
const SIZE_META = {
  512: { icon: 'bolt', label: 'Fast', desc: 'Drafts & quick iterations' },
  768: { icon: 'bolt', label: 'Small', desc: 'Light & quick' },
  1024: { icon: 'chat', label: 'Standard', desc: 'Balanced quality & speed' },
  1280: { icon: 'sparkle', label: 'Large', desc: 'Sharper detail, slower' },
  1536: { icon: 'crown', label: 'Max', desc: 'Highest quality, slowest' },
};
const imageSize = () => (SIZE_OPTIONS.includes(prefs.imgSize) ? prefs.imgSize : 1024);

function metaFor(id) {
  const base = id.replace('-thinking-lite', '').replace('-thinking', '');
  return MODEL_META[base] || MODEL_META[id] || {};
}
function iconFor(id) { return MODEL_ICONS[metaFor(id).icon] || MODEL_ICONS.chat; }
function descFor(id) { return metaFor(id).desc || (isThinkingModel(id) ? 'Deep thinking mode' : ''); }

const DEFAULT_MODELS = [
  { id: 'gemini-3.5-flash', description: MODEL_META['gemini-3.5-flash'].desc },
  { id: 'gemini-3.5-flash-thinking', description: MODEL_META['gemini-3.5-flash-thinking'].desc },
  { id: 'gemini-3.5-flash-thinking-lite', description: MODEL_META['gemini-3.5-flash-thinking-lite'].desc },
  { id: 'gemini-3.7-flash', description: MODEL_META['gemini-3.7-flash'].desc },
  { id: 'gemini-3.1-pro', description: MODEL_META['gemini-3.1-pro'].desc },
  { id: 'gemini-flash-lite', description: MODEL_META['gemini-flash-lite'].desc },
  { id: 'gemini-auto', description: MODEL_META['gemini-auto'].desc },
];

// Map (selected model, thinking toggle) to a model id that actually exists.
function resolveModel(base, wantThinking) {
  const known = models.length ? models : DEFAULT_MODELS;
  const ids = known.map((m) => m.id);
  const has = (id) => ids.includes(id);
  let m = base;

  // For Gemini models, use the existing thinking logic
  const isGemini = base.startsWith('gemini');
  if (isGemini && wantThinking && !m.includes('thinking')) {
    const candidate = m + '-thinking';
    if (has(candidate)) m = candidate;
  } else if (isGemini && !wantThinking && m.includes('thinking')) {
    const stripped = m.replace('-thinking-lite', '').replace('-thinking', '');
    m = stripped && has(stripped) ? stripped : (has('gemini-3.5-flash') ? 'gemini-3.5-flash' : m);
  }
  return m;
}

async function loadModels() {
  try {
    const res = await fetch('/api/models');
    const j = await res.json();
    const list = (j.data || []).map((m) => ({ id: m.id, description: m.description || '' }));
    if (list.length) models = list;
    else models = DEFAULT_MODELS.slice();
  } catch {
    models = DEFAULT_MODELS.slice();
  }
  // Reset a stale/invalid saved model
  if (!models.some((m) => m.id === prefs.model)) {
    prefs.model = resolveModel(prefs.model, prefs.thinking);
    if (!models.some((m) => m.id === prefs.model)) prefs.model = 'gemini-3.5-flash';
    savePrefs();
    updateModelUI();
  }
  // If no Gemini model is currently selected, default to Gemini
  const hasGemini = models.some((m) => m.id.startsWith('gemini'));
  const selectedIsGemini = prefs.model.startsWith('gemini');
  if (!selectedIsGemini && hasGemini) {
    prefs.model = 'gemini-3.5-flash';
    savePrefs();
    updateModelUI();
  }
  // Thinking toggle only makes sense when a -thinking model exists
  const anyThinking = models.some((m) => m.id.includes('thinking'));
  els.thinkingBtn.style.display = anyThinking ? '' : 'none';
  if (!anyThinking && prefs.thinking) { prefs.thinking = false; savePrefs(); updateModelUI(); }
  renderModelList();
}

function renderModelList() {
  els.modelList.innerHTML = '';
  for (const m of models) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'model-item' + (m.id === prefs.model ? ' selected' : '');
    item.innerHTML =
      '<span class="mi-icon">' + iconFor(m.id) + '</span>' +
      '<div style="min-width:0"><div class="mi-name"></div><div class="mi-desc"></div></div>' +
      '<svg class="mi-check" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4 10-10"/></svg>';
    item.querySelector('.mi-name').textContent = m.id;
    item.querySelector('.mi-desc').textContent = m.description || descFor(m.id);
    item.addEventListener('click', () => {
      prefs.model = m.id;
      prefs.thinking = isThinkingModel(m.id); // keep toggle in sync with the chosen model
      savePrefs();
      updateModelUI();
      closeOverlay(els.modelOverlay);
      toast('Model: ' + m.id + (prefs.thinking ? '  🧠' : ''));
    });
    els.modelList.appendChild(item);
  }
}

function updateModelUI() {
  els.modelLabel.textContent = prefs.model;
  els.thinkingBtn.setAttribute('aria-checked', String(prefs.thinking));
}

/* ==================== Image size picker ==================== */
function updateSizeUI() {
  els.sizeLabel.textContent = imageSize() + 'px';
}

function buildSizeSheet() {
  els.sizeList.innerHTML = '';
  for (const s of SIZE_OPTIONS) {
    const meta = SIZE_META[s] || {};
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'model-item size-item' + (s === imageSize() ? ' selected' : '');
    item.innerHTML =
      '<span class="mi-icon">' + (MODEL_ICONS[meta.icon] || MODEL_ICONS.chat) + '</span>' +
      '<div style="min-width:0"><div class="mi-name"></div><div class="mi-desc"></div></div>' +
      '<span class="mi-size">' + s + '×' + s + '</span>' +
      '<svg class="mi-check" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4 10-10"/></svg>';
    item.querySelector('.mi-name').textContent = meta.label ? meta.label + ' — ' + s + 'px' : s + 'px';
    item.querySelector('.mi-desc').textContent = meta.desc || '';
    item.addEventListener('click', () => {
      prefs.imgSize = s;
      savePrefs();
      updateSizeUI();
      closeOverlay(els.sizeOverlay);
      toast('Image size: ' + s + '×' + s);
    });
    els.sizeList.appendChild(item);
  }
}

/* ==================== Overlays ==================== */
function openOverlay(ov) { ov.hidden = false; }
function closeOverlay(ov) { ov.hidden = true; }

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeOverlay(els.modelOverlay);
    closeOverlay(els.sizeOverlay);
    closeOverlay(els.confirmOverlay);
    closeSidebar();
  }
});
[els.modelOverlay, els.sizeOverlay, els.confirmOverlay].forEach((ov) =>
  ov.addEventListener('click', (e) => { if (e.target === ov) closeOverlay(ov); })
);

let confirmHandler = null;
function confirmDialog(title, msg, onOk) {
  els.confirmTitle.textContent = title;
  els.confirmMsg.textContent = msg;
  openOverlay(els.confirmOverlay);
  if (confirmHandler) els.confirmOk.removeEventListener('click', confirmHandler);
  confirmHandler = () => {
    els.confirmOk.removeEventListener('click', confirmHandler);
    confirmHandler = null;
    closeOverlay(els.confirmOverlay);
    onOk();
  };
  els.confirmOk.addEventListener('click', confirmHandler);
}
els.confirmCancel.addEventListener('click', () => closeOverlay(els.confirmOverlay));

/* ==================== Sidebar (toggle + mobile drawer) ==================== */
els.menu.addEventListener('click', toggleSidebar);
els.sidebarClose.addEventListener('click', toggleSidebar);
els.scrim.addEventListener('click', closeSidebar);

function closeSidebar() { document.body.classList.remove('sidebar-open'); }

/* ==================== Wire up ==================== */
els.newChat.addEventListener('click', createChat);

els.search.addEventListener('input', renderList);

els.deleteBtn.addEventListener('click', () => {
  const chat = activeChat();
  if (!chat) { toast('No chat selected'); return; }
  confirmDialog('Delete chat?', '“' + chat.title + '” will be permanently removed from this device.', () => deleteChat(chat.id));
});

els.exportBtn.addEventListener('click', () => {
  const chat = activeChat();
  if (!chat || !chat.messages.length) { toast('Nothing to export'); return; }
  const lines = chat.messages.map((m) => '## ' + (m.role === 'user' ? 'You' : 'Assistant') + '\n\n' + m.content).join('\n\n---\n\n');
  const blob = new Blob(['# ' + chat.title + '\n\n' + lines], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = chat.title.replace(/[^\w\d-]+/g, '_') + '.md';
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Exported as Markdown');
});

// Inline rename
els.title.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); els.title.blur(); }
});
els.title.addEventListener('blur', () => {
  const chat = activeChat();
  if (chat) renameChat(chat.id, els.title.textContent);
});

// Composer
els.input.addEventListener('input', () => {
  els.input.style.height = 'auto';
  els.input.style.height = Math.min(els.input.scrollHeight, 200) + 'px';
});
els.input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (!streaming) els.composer.requestSubmit();
  } else if (e.key === 'ArrowUp' && !els.input.value) {
    // Recall the last sent message to edit and resend
    const chat = activeChat();
    const lastUser = chat && [...chat.messages].reverse().find((m) => m.role === 'user');
    if (lastUser) {
      e.preventDefault();
      els.input.value = lastUser.content;
      els.input.dispatchEvent(new Event('input'));
    }
  }
});

/* ==================== Keyboard shortcuts ==================== */
document.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (!mod) return;
  const k = e.key.toLowerCase();
  if (k === 'k') { e.preventDefault(); createChat(); }
  else if (k === 'b') { e.preventDefault(); toggleSidebar(); }
  else if (k === 'f' && !e.shiftKey) { e.preventDefault(); closeSidebar(); els.search.focus(); els.search.select(); }
});
els.composer.addEventListener('submit', (e) => {
  e.preventDefault();
  if (imageBusy) { toast('Generating image…'); return; }
  if (streaming) { // button acts as Stop while streaming
    stopFlag = true;
    if (controller) controller.abort();
    return;
  }
  const text = els.input.value.trim();
  if (!text) return;
  els.input.value = '';
  els.input.style.height = 'auto';
  if (imageMode) generateImage(text);
  else sendMessage(text);
});

// Image mode toggle
els.imgBtn.addEventListener('click', () => setImageMode(!imageMode));
els.imgBtn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); els.imgBtn.click(); } });

// Thinking toggle
els.thinkingBtn.addEventListener('click', () => {
  prefs.thinking = !prefs.thinking;
  savePrefs();
  updateModelUI();
  toast(prefs.thinking ? 'Thinking mode on' : 'Thinking mode off');
});

// Model sheet
els.modelBtn.addEventListener('click', () => { openOverlay(els.modelOverlay); loadModels(); });
els.modelCloseBtn.addEventListener('click', () => closeOverlay(els.modelOverlay));

// Image size sheet
els.sizeBtn.addEventListener('click', () => { buildSizeSheet(); openOverlay(els.sizeOverlay); });
els.sizeCloseBtn.addEventListener('click', () => closeOverlay(els.sizeOverlay));
els.reasoningToggle.addEventListener('click', () => els.reasoningPanel.classList.toggle('closed'));

/* ==================== Boot ==================== */
renderSuggestions(); // fresh starter prompts each refresh
applyTheme();
applySidebar();
applyImageMode();
updateModelUI();
updateSizeUI();
loadModels(); // fetch model list up front so resolution is validated from the start
renderList();
if (!activeId || !getChat(activeId)) activeId = db.chats[0] ? db.chats[0].id : null;
renderChat();
els.input.focus();
