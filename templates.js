// Auspacific carousel templates, rendered from HTML.
// Shared by the dashboard (live preview) and render/render.mjs (PNG export), so the
// preview is exactly what gets posted. One page = one 1080×1440 HTML document.
//
// design_text page kinds: cover · table · list · flow · checklist · cta
// Text markup: 【文字】 = accent colour. "\n" inside a string = line break.

export const W = 1080, H = 1440;

export const THEMES = {
  navy: {
    name: "深藍＋香檳金",
    coverBg: "#1D2A4A", coverInk: "#FFFFFF", coverAccent: "#D4C27A", coverMuted: "#C9CFDC",
    bg: "#F8F7F3", ink: "#1D2A4A", body: "#2E3445", muted: "#6B6E78", key: "#1D2A4A",
    accent: "#1D2A4A", hlBg: "#E6D795", hlInk: "#1D2A4A", line: "#BDBBB4",
    boxBg: "#1D2A4A", boxInk: "#FFFFFF", boxMuted: "#D4C27A", kwBg: "#E6D795", kwInk: "#1D2A4A",
  },
  blue: {
    name: "藍＋淺灰白",
    coverBg: "#1A57A0", coverInk: "#FFFFFF", coverAccent: "#FFFFFF", coverMuted: "#D6E3F3",
    bg: "#F4F6FA", ink: "#1E2A44", body: "#2E3A52", muted: "#66708A", key: "#1A57A0",
    accent: "#1A57A0", hlBg: "#D3E2F4", hlInk: "#1A57A0", line: "#BCC3D1",
    boxBg: "#1A57A0", boxInk: "#FFFFFF", boxMuted: "#D6E3F3", kwBg: "#D3E2F4", kwInk: "#1A57A0",
  },
  charcoal: {
    name: "炭黑＋陶土橘",
    coverBg: "#14171F", coverInk: "#FFFFFF", coverAccent: "#D96B2A", coverMuted: "#C9CBD1",
    bg: "#FFFFFF", ink: "#1E2742", body: "#2E3445", muted: "#6B6E78", key: "#1E2742",
    accent: "#D96B2A", hlBg: "#F7D9C4", hlInk: "#C2541A", line: "#C8C7CC",
    boxBg: "#D96B2A", boxInk: "#FFFFFF", boxMuted: "#FBE3D3", kwBg: "#F7D9C4", kwInk: "#C2541A",
  },
};

export const FONT_CSS_URL = "https://fonts.googleapis.com/css2?family=Noto+Serif+TC:wght@400;600;700;900&display=block";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// 【x】 → accent span; \n → <br>
export function rich(s) {
  return esc(s).replace(/【(.+?)】/g, '<span class="ac">$1</span>').replace(/\n/g, "<br>");
}
const lines = (arr, cls) => (arr || []).filter(Boolean).map((l) => `<div class="${cls}">${rich(l)}</div>`).join("");
const pad2 = (n) => String(n).padStart(2, "0");

function css(t) {
  return `
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${W}px;height:${H}px;overflow:hidden}
body{font-family:"Noto Serif TC",serif;-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision}
.page{position:relative;width:${W}px;height:${H}px;padding:130px 112px 0;background:${t.bg};color:${t.body}}
.cover{background:${t.coverBg};color:${t.coverInk}}
.ac{color:${t.accent}}
.cover .ac{color:${t.coverAccent}}
.label{font-size:26px;letter-spacing:2px;color:${t.muted};font-weight:400}
.title{margin-top:58px;font-size:84px;line-height:1.22;font-weight:900;color:${t.ink};letter-spacing:1px}
.fit{position:absolute;left:112px;right:112px;top:var(--top,420px);bottom:var(--bottom,250px);overflow:hidden}
.fit-inner{transform-origin:top left}
.intro{font-size:36px;line-height:1.65;color:${t.body}}
.rows{margin-top:34px;border-top:2px solid ${t.line}}
.row{display:flex;border-bottom:2px solid ${t.line};min-height:110px}
.row .k{flex:0 0 200px;display:flex;align-items:center;padding:20px 0 20px 22px;font-size:34px;font-weight:900;color:${t.key};border-right:2px solid ${t.line}}
.row .v{flex:1;padding:22px 0 22px 26px;display:flex;flex-direction:column;justify-content:center}
.row .t{font-size:33px;line-height:1.5;color:${t.body}}
.row .s{margin-top:4px;font-size:24px;line-height:1.45;color:${t.muted}}
.row.compact{min-height:86px}.row.compact .v{padding:16px 0 16px 26px}
.list .it{border-bottom:2px solid ${t.line};padding:26px 0;font-size:35px;line-height:1.5;color:${t.body}}
.list .it b{font-weight:900;color:${t.key}}
.notes{margin-top:34px}
.note{font-size:26px;line-height:1.7;color:${t.muted}}
.flow{display:flex;align-items:center;gap:20px;margin:56px 0 46px}
.flow .st{border:3px solid ${t.ink};padding:22px 26px;font-size:33px;font-weight:900;color:${t.key};background:transparent;white-space:nowrap}
.flow .ar{font-size:40px;color:${t.ink}}
.check .it{display:flex;border-bottom:2px solid ${t.line};padding:28px 0;font-size:34px;line-height:1.45}
.check .it .n{flex:0 0 270px;font-weight:900;color:${t.key}}
.check .it .x{flex:1;color:${t.body}}
.hl{position:absolute;left:112px;right:112px;bottom:190px;font-size:38px;font-weight:900;line-height:1.5;color:${t.hlInk}}
.hl span{background:${t.hlBg};padding:2px 10px;box-decoration-break:clone;-webkit-box-decoration-break:clone}
.foot{position:absolute;left:112px;right:112px;bottom:66px;display:flex;justify-content:space-between;font-size:28px;color:${t.muted}}
.cover .foot{color:${t.coverMuted}}
/* cover */
.brand{font-size:30px;letter-spacing:6px;font-weight:600;color:${t.coverInk}}
.series{margin-top:16px;font-size:26px;color:${t.coverAccent}}
.c-title{margin-top:96px;font-size:72px;line-height:1.38;font-weight:400;color:${t.coverInk}}
.kw{margin-top:6px;font-size:300px;line-height:1.05;font-weight:900;color:${t.coverAccent};letter-spacing:-4px;white-space:nowrap}
.c-sub{margin-top:34px;font-size:36px;line-height:1.6;color:${t.coverMuted}}
.rule{margin-top:54px;width:240px;border-top:3px solid ${t.coverAccent};opacity:.8}
.teaser{margin-top:40px;font-size:38px;font-weight:900;color:${t.coverAccent}}
/* cta */
.box{margin-top:50px;background:${t.boxBg};color:${t.boxInk};padding:40px 52px}
.box .bk{font-size:28px;color:${t.boxMuted};font-weight:600}
.box .bt{margin-top:14px;font-size:48px;font-weight:900}
.box .bs{margin-top:14px;font-size:28px;color:${t.boxMuted}}
.dm{margin-top:56px;display:flex;align-items:center;gap:20px}
.dm .p{font-size:44px;font-weight:900;color:${t.ink}}
.dm .w{font-size:96px;font-weight:900;color:${t.kwInk};background:${t.kwBg};padding:0 22px;line-height:1.25}
.reply{margin-top:14px;font-size:34px;color:${t.body}}
.legal{position:absolute;left:112px;right:112px;bottom:150px;font-size:21px;line-height:1.7;color:${t.muted}}
`;
}

function fitWrap(inner, top, bottom) {
  return `<div class="fit" style="--top:${top}px;--bottom:${bottom}px"><div class="fit-inner">${inner}</div></div>`;
}

function body(page, ctx) {
  const foot = `<div class="foot"><span>${esc(ctx.handle)}</span><span>${pad2(ctx.pageNo)}</span></div>`;
  const hl = page.highlight ? `<div class="hl"><span>${rich(page.highlight)}</span></div>` : "";
  const head = `<div class="label">${rich(page.label || "")}</div><div class="title">${(page.title || []).map(rich).join("<br>")}</div>`;
  const bottom = page.highlight ? 300 : 200;
  switch (page.kind) {
    case "cover":
      return `<div class="page cover">
        <div class="brand">AUSPACIFIC</div>
        <div class="series">${rich(page.series || "")}</div>
        ${fitWrap(`
          <div class="c-title" style="margin-top:0">${(page.title || []).map(rich).join("<br>")}</div>
          ${page.keyword ? `<div class="kw">${esc(page.keyword)}</div>` : ""}
          <div class="c-sub">${lines(page.sub, "l")}</div>
          <div class="rule"></div>
          ${page.teaser ? `<div class="teaser">${rich(page.teaser)}</div>` : ""}`, 300, 170)}
        ${foot}</div>`;
    case "table":
      return `<div class="page">${head}${fitWrap(`
        ${lines(page.intro, "intro")}
        <div class="rows">${(page.rows || []).map((r) => `<div class="row${r.sub ? "" : " compact"}"><div class="k">${rich(r.key)}</div><div class="v"><div class="t">${rich(r.text)}</div>${r.sub ? `<div class="s">${rich(r.sub)}</div>` : ""}</div></div>`).join("")}</div>
        ${page.note ? `<div class="notes"><div class="note">${rich(page.note)}</div></div>` : ""}`, 490, bottom)}${hl}${foot}</div>`;
    case "list":
      return `<div class="page">${head}${fitWrap(`
        ${lines(page.intro, "intro")}
        <div class="list">${(page.items || []).map((i) => `<div class="it"><b>${rich(i.key)}：</b>${rich(i.text)}</div>`).join("")}</div>
        <div class="notes">${lines(page.notes, "note")}</div>`, 490, bottom)}${hl}${foot}</div>`;
    case "flow":
      return `<div class="page">${head}${fitWrap(`
        ${lines(page.intro, "intro")}
        <div class="flow">${(page.steps || []).map((s, i) => `${i ? '<span class="ar">→</span>' : ""}<span class="st">${rich(s)}</span>`).join("")}</div>
        ${lines((page.cautions || []).map((c) => "⚠ " + c), "note")}`, 490, bottom)}${hl}${foot}</div>`;
    case "checklist":
      return `<div class="page">${head}${fitWrap(`
        <div class="check">${(page.items || []).map((i, n) => `<div class="it"><span class="n">${"①②③④⑤⑥⑦"[n] || n + 1} ${rich(i.key)}</span><span class="x">${rich(i.text)}</span></div>`).join("")}</div>`, 490, bottom)}${hl}${foot}</div>`;
    case "cta": {
      const b = page.box || {};
      return `<div class="page">${head}${fitWrap(`
        ${lines(page.intro, "intro")}
        ${b.title ? `<div class="box"><div class="bk">${rich(b.kicker || "")}</div><div class="bt">${rich(b.title)}</div><div class="bs">${rich(b.sub || "")}</div></div>` : ""}
        ${page.keyword ? `<div class="dm"><span class="p">私訊</span><span class="w">${esc(page.keyword)}</span></div><div class="reply">${rich(page.reply || "我們一對一回覆你")}</div>` : ""}`, 490, 290)}
        <div class="legal">${(ctx.legal || []).map(esc).join("<br>")}</div>${foot}</div>`;
    }
    default:
      return `<div class="page">${head}<div class="intro" style="margin-top:40px;color:#c00">未知的頁面類型：${esc(page.kind)}</div>${foot}</div>`;
  }
}

// Shrinks each .fit-inner until it fits (min 72%); reports pages that still overflow.
const FIT_SCRIPT = `
(async()=>{try{await document.fonts.ready}catch(e){}
const res={overflow:[]};
document.querySelectorAll('.fit').forEach((f,i)=>{const inner=f.firstElementChild;let s=1;
inner.style.width=f.clientWidth+'px';
while(inner.scrollHeight*s>f.clientHeight+1&&s>0.72){s-=0.02;inner.style.transform='scale('+s+')';inner.style.width=(f.clientWidth/s)+'px';}
if(inner.scrollHeight*s>f.clientHeight+1)res.overflow.push(i);
});
document.querySelectorAll('.kw').forEach(k=>{let fs=300;while(k.scrollWidth>k.parentElement.clientWidth&&fs>140){fs-=10;k.style.fontSize=fs+'px';}});
window.__fit=res;document.body.dataset.ready='1';})();`;

export function pageHTML(page, ctx) {
  const t = THEMES[ctx.theme] || THEMES.navy;
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<link rel="stylesheet" href="${FONT_CSS_URL}"><style>${css(t)}</style></head>
<body>${body(page, ctx)}<script>${FIT_SCRIPT}</script></body></html>`;
}

// Chooses the theme from the post (explicit `template`, else from pillar) and returns one HTML per page.
export function postPages(post, brand, templatesCfg) {
  const theme = themeFor(post, templatesCfg);
  const pages = Array.isArray(post.design_text) ? post.design_text : [];
  const legal = [
    [brand?.account?.broker_name_line, brand?.legal?.address, brand?.legal?.phone].filter(Boolean).join("｜"),
    [brand?.account?.disclaimer, brand?.legal?.fx_note].filter(Boolean).join("　"),
  ];
  const handle = brand?.platforms?.instagram?.handle || "@auspacific_taiwan";
  return pages.map((p, i) => pageHTML(p, { theme, handle, pageNo: i + 1, total: pages.length, legal }));
}

export function themeFor(post, templatesCfg) {
  if (post.template && THEMES[post.template]) return post.template;
  const map = templatesCfg?.pillar_theme || {};
  return map[post.pillar] || "navy";
}
