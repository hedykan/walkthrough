// 走读正文的 Markdown 子集 → HTML。认：**粗体**、`代码`、[文本](目标)、「- 」与「1. 」列表、# 标题、``` 代码块、空行分段。
// 先整体转义再还原语法，所以正文里混进的任何 HTML 都会被当成纯文本显示，不会执行。

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function renderInline(src: string): string {
  let s = esc(src);
  const codes: string[] = [];
  s = s.replace(/`([^`]+)`/g, (_m, c: string) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text: string, target: string) =>
    `<a href="#" class="ln" data-link="${target}">${text}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => `<code>${codes[+i]}</code>`);
  return s;
}

export function renderMd(src: string | null | undefined): string {
  if (!src) return '';
  const out: string[] = [];
  let para: string[] = [];
  let list: { tag: 'ul' | 'ol'; items: string[] } | null = null;
  let fence: string[] | null = null;
  const flushPara = () => { if (para.length) { out.push(`<p>${para.map(renderInline).join('<br>')}</p>`); para = []; } };
  const flushList = () => { if (list) { out.push(`<${list.tag}>${list.items.map(i => `<li>${renderInline(i)}</li>`).join('')}</${list.tag}>`); list = null; } };
  for (const line of src.split('\n')) {
    if (fence) {
      if (/^\s*```/.test(line)) { out.push(`<pre><code>${esc(fence.join('\n'))}</code></pre>`); fence = null; }
      else fence.push(line);
      continue;
    }
    if (/^\s*```/.test(line)) { flushPara(); flushList(); fence = []; continue; }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { flushPara(); flushList(); out.push(`<h${h[1].length + 2}>${renderInline(h[2])}</h${h[1].length + 2}>`); continue; }
    const ul = line.match(/^\s*[-*]\s+(.*)$/), ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const item = ul ?? ol;
    if (item) {
      flushPara();
      const tag = ul ? 'ul' : 'ol';
      if (list && list.tag !== tag) flushList();
      (list ??= { tag, items: [] }).items.push(item[1]);
      continue;
    }
    if (!line.trim()) { flushPara(); flushList(); continue; }
    flushList(); para.push(line);
  }
  if (fence) out.push(`<pre><code>${esc(fence.join('\n'))}</code></pre>`);
  flushPara(); flushList();
  return out.join('');
}
