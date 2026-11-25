import { approvalHash, finalCaption } from "./approval.js";
import { postPages } from "./templates.js";
let siteCfg = { brand: {}, templates: {} };

// ---------- constants ----------
const TZ_OFFSET = "+08:00"; // Asia/Taipei, no daylight saving
const PLATFORMS = {
  instagram: { label: "Instagram", max: 2200 },
  facebook: { label: "Facebook", max: 5000 },
  threads: { label: "Threads", max: 500 },
};
const STATUS = {
  content_review: "內容待審核",
  content_approved: "內容已核准・等待製作",
  ready_to_film: "等待拍攝上傳",
  needs_export: "等待從 Canva 重新匯出",
  design_review: "成品待審核",
  approved: "已排程",
  published: "已發布",
  failed: "發布失敗",
  changed_after_approval: "核准後被修改",
  missed: "錯過發布時間",
  rejected: "已退回",
};
const FILTERS = {
  content: ["content_review"],
  making: ["content_approved", "ready_to_film", "needs_export"],
  final: ["design_review", "failed", "changed_after_approval", "missed"],
  scheduled: ["approved"],
  done: ["published", "rejected"],
  all: null,
};
const FIELD_LABELS = {
  tag: "系列標籤", headline_1: "標題第一行", headline_2: "標題第二行（【】內為金色重點字）", title: "頁標題",
  rows: "數據列", label: "項目", value: "數字", source_line: "資料來源列", items: "清單項目",
  headline: "標題", cta: "行動呼籲", counter: "頁碼",
  subhead: "副標（一句話）", note: "註解", text: "內容", detail: "補充說明", paragraphs: "段落",
  series: "系列小標", keyword: "大字關鍵字", sub: "副標", teaser: "引言", label: "頁首小標", intro: "說明文字",
  key: "項目", items: "條列", notes: "小字備註", steps: "流程步驟", cautions: "風險提醒", box: "諮詢框",
  kicker: "框內小標", reply: "回覆文字", highlight: "重點標示（底部）",
};
// Mirrors brand.json "never" rules.
const BANNED = ["保證", "穩賺", "必漲", "高報酬", "翻倍", "保本", "零風險", "搶手", "最後機會", "錯過不再", "LINE ID", "line.me", "保證增值", "財富引擎", "躺著賺", "全球獨家", "Podcast", "公立學校免費"];
const MAX_UPLOAD = 95 * 1024 * 1024; // GitHub contents API limit is 100 MB

// ---------- state ----------
const cfg = loadCfg();
let posts = [];
let filter = "content";
let current = null;
let activePlatform = null;

// ---------- GitHub API ----------
function loadCfg() {
  try { return JSON.parse(localStorage.getItem("auspacific-dashboard") || "{}"); } catch { return {}; }
}
function saveCfg(c) {
  try { localStorage.setItem("auspacific-dashboard", JSON.stringify(c)); } catch { /* private mode */ }
  Object.assign(cfg, c);
}
async function gh(path, opts = {}) {
  const res = await fetch(`https://api.github.com/repos/${cfg.repo}/${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${cfg.token}`, Accept: "application/vnd.github+json", ...(opts.headers || {}) },
  });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).message || msg; } catch { /* ignore */ }
    const err = new Error(`GitHub ${res.status}: ${msg}`);
    err.status = res.status;
    throw err;
  }
  return res;
}
const branch = () => cfg.branch || "main";
const ref = () => `ref=${encodeURIComponent(branch())}`;
const b64decode = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, "")), (c) => c.charCodeAt(0)));
function bytesToB64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
const b64encode = (str) => bytesToB64(new TextEncoder().encode(str));

async function listPosts() {
  let dirs;
  try {
    dirs = await (await gh(`contents/posts?${ref()}`)).json();
  } catch (e) {
    if (e.status === 404) return [];
    throw e;
  }
  const ids = dirs.filter((d) => d.type === "dir" && !d.name.startsWith("_")).map((d) => d.name);
  const out = await Promise.all(ids.map(async (id) => {
    try {
      const f = await (await gh(`contents/posts/${id}/post.json?${ref()}`)).json();
      return { id, post: JSON.parse(b64decode(f.content)), sha: f.sha };
    } catch { return null; }
  }));
  return out.filter(Boolean).sort((a, b) => (a.post.publish_at || "").localeCompare(b.post.publish_at || ""));
}

async function loadMedia(id, post) {
  const media = {};
  if (!(post.media || []).length) return media;
  const files = await (await gh(`contents/posts/${id}?${ref()}`)).json();
  await Promise.all(post.media.map(async (name) => {
    const f = files.find((x) => x.name === name);
    if (!f) { media[name] = { sha: "", url: "" }; return; }
    const raw = await gh(`contents/posts/${id}/${encodeURIComponent(name)}?${ref()}`, { headers: { Accept: "application/vnd.github.raw" } });
    media[name] = { sha: f.sha, url: URL.createObjectURL(await raw.blob()) };
  }));
  return media;
}

async function savePost(entry, message) {
  const body = JSON.stringify(entry.post, null, 2) + "\n";
  const res = await (await gh(`contents/posts/${entry.id}/post.json`, {
    method: "PUT",
    body: JSON.stringify({ message, content: b64encode(body), sha: entry.sha, branch: branch() }),
  })).json();
  entry.sha = res.content.sha;
}

async function uploadFile(id, name, file) {
  let sha;
  try { sha = (await (await gh(`contents/posts/${id}/${name}?${ref()}`)).json()).sha; } catch { /* new file */ }
  const content = bytesToB64(new Uint8Array(await file.arrayBuffer()));
  await gh(`contents/posts/${id}/${name}`, {
    method: "PUT",
    body: JSON.stringify({ message: `Upload ${name} for ${id}`, content, branch: branch(), ...(sha ? { sha } : {}) }),
  });
}

async function deletePost(id) {
  const files = await (await gh(`contents/posts/${id}?${ref()}`)).json();
  for (const f of files.filter((x) => x.type === "file")) {
    await gh(`contents/posts/${id}/${encodeURIComponent(f.name)}`, {
      method: "DELETE",
      body: JSON.stringify({ message: `Delete ${id}: ${f.name}`, sha: f.sha, branch: branch() }),
    });
  }
}

// A random :00 or :30 slot between 10:00 and 23:30 (Taipei).
function randomSlot() {
  const n = Math.floor(Math.random() * 28); // 10:00 … 23:30
  return `${String(10 + Math.floor(n / 2)).padStart(2, "0")}:${n % 2 ? "30" : "00"}`;
}


// ---------- new post from finished files ----------
let draft = null; // { files: [File], urls: [objectURL], ratios: [] }
function openNewPost() {
  draft = { files: [], urls: [], ratios: [] };
  current = null;
  $("#listView").hidden = true; $("#detailView").hidden = false;
  const today = splitLocal(new Date().toISOString())[0];
  $("#detail").innerHTML = `
  <div class="detail-grid">
    <div>
      <div class="panel"><h3>圖片或影片</h3>
        <p class="muted" style="margin-top:0">單張圖或輪播：1–10 張 JPG／PNG（建議 1080×1440 或 1080×1350）。Reel：1 支 MP4／MOV，95 MB 以內。</p>
        <input type="file" id="npFiles" multiple accept="image/jpeg,image/png,video/mp4,video/quicktime">
        <div id="npMedia" class="np-media"></div>
      </div>
    </div>
    <div>
      <div class="panel"><h3>新增貼文（已完成的圖片／影片）</h3>
        <label>標題（只顯示在列表）<input id="npTitle" placeholder="例：留學住宿比一比"></label>
        <div class="row">
          <label>日期<input type="date" id="npDate" min="${today}" value="${today}"></label>
          <label>時間<input type="time" id="npTime" step="1800" min="10:00" max="23:30" value="${randomSlot()}"></label>
          <button type="button" id="npRand" class="ghost" style="flex:0 0 auto;align-self:end;margin-bottom:10px">🎲 隨機時間</button>
        </div>
        <div class="row">${["instagram", "facebook"].map((k) => `<label style="flex:0 0 auto;font-weight:400"><input type="checkbox" data-np-platform="${k}" style="width:auto" checked> ${PLATFORMS[k].label}</label>`).join("")}</div>
      </div>
      ${["instagram", "facebook"].map((k) => `<div class="panel"><h3>${PLATFORMS[k].label} 文案</h3>
        <textarea id="npCap-${k}" placeholder="貼上要發在 ${PLATFORMS[k].label} 的文字"></textarea>
        <label>Hashtags（空格分隔）<input id="npTags-${k}" placeholder="#墨爾本留學 #auspacific_taiwan"></label></div>`).join("")}
      <div class="actions"><button type="button" id="npSave" class="gold">建立貼文，送到 ③ 成品審核</button></div>
    </div>
  </div>`;
  $("#npRand").onclick = () => { $("#npTime").value = randomSlot(); };
  $("#npFiles").onchange = (e) => { addDraftFiles([...e.target.files]); e.target.value = ""; };
  $("#npSave").onclick = saveNewPost;
  for (const ta of document.querySelectorAll("#detail textarea")) { autosize(ta); ta.addEventListener("input", () => autosize(ta)); }
}
async function addDraftFiles(list) {
  for (const f of list) {
    if (f.size > MAX_UPLOAD) { toast(`${f.name} 超過 95 MB`, true); continue; }
    const url = URL.createObjectURL(f);
    let ratio = 0;
    if (f.type.startsWith("image/")) ratio = await new Promise((r) => { const i = new Image(); i.onload = () => r(i.naturalWidth / i.naturalHeight); i.onerror = () => r(0); i.src = url; });
    draft.files.push(f); draft.urls.push(url); draft.ratios.push(ratio);
  }
  drawDraftMedia();
}
function drawDraftMedia() {
  const box = $("#npMedia"); if (!box) return;
  box.innerHTML = draft.files.map((f, i) => `<div class="np-item">
    ${f.type.startsWith("video/") ? `<video src="${draft.urls[i]}" muted></video>` : `<img src="${draft.urls[i]}" alt="">`}
    <div class="np-ctl"><span>${i + 1}</span>
      <button type="button" class="ghost" data-np-up="${i}" ${i ? "" : "disabled"}>↑</button>
      <button type="button" class="ghost" data-np-down="${i}" ${i < draft.files.length - 1 ? "" : "disabled"}>↓</button>
      <button type="button" class="ghost danger" data-np-del="${i}">✕</button></div>
    ${draft.ratios[i] && (draft.ratios[i] < 0.74 || draft.ratios[i] > 1.92) ? `<small class="bad">比例不符 IG（${draft.ratios[i].toFixed(2)}）</small>` : ""}</div>`).join("");
  const move = (i, j) => { for (const k of ["files", "urls", "ratios"]) [draft[k][i], draft[k][j]] = [draft[k][j], draft[k][i]]; drawDraftMedia(); };
  for (const b of box.querySelectorAll("[data-np-up]")) b.onclick = () => move(+b.dataset.npUp, +b.dataset.npUp - 1);
  for (const b of box.querySelectorAll("[data-np-down]")) b.onclick = () => move(+b.dataset.npDown, +b.dataset.npDown + 1);
  for (const b of box.querySelectorAll("[data-np-del]")) b.onclick = () => { const i = +b.dataset.npDel; for (const k of ["files", "urls", "ratios"]) draft[k].splice(i, 1); drawDraftMedia(); };
}
async function saveNewPost() {
  const vids = draft.files.filter((f) => f.type.startsWith("video/")), imgs = draft.files.filter((f) => f.type.startsWith("image/"));
  const platforms = [...document.querySelectorAll("[data-np-platform]")].filter((c) => c.checked).map((c) => c.dataset.npPlatform);
  const date = $("#npDate").value, time = $("#npTime").value;
  const err = !draft.files.length ? "請先加入圖片或影片"
    : vids.length && (vids.length > 1 || imgs.length) ? "Reel 只能放 1 支影片，不能和圖片混在一起"
    : imgs.length > 10 ? "輪播最多 10 張" : !platforms.length ? "請勾選平台"
    : !date ? "請選日期" : !/^(1\d|2[0-3]):(00|30)$/.test(time) ? "時間請選 10:00–23:30 的整點或半點"
    : platforms.some((k) => !$(`#npCap-${k}`).value.trim()) ? "每個勾選的平台都要有文案" : "";
  if (err) { toast(err, true); return; }
  const dow = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][new Date(`${date}T12:00:00${TZ_OFFSET}`).getUTCDay()];
  let n = 1; while (posts.some((x) => x.id === `${date}-${dow}-upload-${n}`)) n++;
  const id = `${date}-${dow}-upload-${n}`;
  const names = vids.length ? [/\.mov$/i.test(vids[0].name) ? "reel.mov" : "reel.mp4"]
    : imgs.map((f, i) => `${String(i + 1).padStart(2, "0")}.${/png$/i.test(f.type) ? "png" : "jpg"}`);
  const tags = (k) => $(`#npTags-${k}`).value.split(/\s+/).filter(Boolean).map((x) => (x.startsWith("#") ? x : `#${x}`));
  const post = {
    id, status: "design_review", publish_at: `${date}T${time}:00${TZ_OFFSET}`,
    format: vids.length ? "reel" : imgs.length > 1 ? "carousel" : "single", production: "manual",
    series: $("#npTitle").value.trim() || "自訂貼文", theme: "", pillar: "", platforms,
    captions: Object.fromEntries(platforms.map((k) => [k, $(`#npCap-${k}`).value])),
    hashtags: Object.fromEntries(platforms.map((k) => [k, tags(k)])),
    design_text: [], reel_script: null, media: names, sources: [], checks: [], review_notes: "",
    history: [{ at: nowIso(), by: "dashboard", action: "uploaded finished post", detail: `${names.length} file(s)` }],
  };
  const btn = $("#npSave"); btn.disabled = true;
  try {
    const files = vids.length ? vids : imgs;
    for (let i = 0; i < files.length; i++) { toast(`上傳中… ${i + 1}/${files.length}`); await uploadFile(id, names[i], files[i]); }
    const entry = { id, post, sha: undefined };
    await savePost(entry, `New post ${id} (uploaded by owner)`);
    posts.push(entry); posts.sort((a, b) => (a.post.publish_at || "").localeCompare(b.post.publish_at || ""));
    draft.urls.forEach((u) => URL.revokeObjectURL(u)); draft = null;
    toast("已建立，請在 ③ 成品審核確認並核准");
    await openPost(id);
  } catch (e) { toast(e.message, true); btn.disabled = false; }
}


// ---------- 「產生下週內容」: asks GitHub to start the claude.ai writing task ----------
function nextMonday() {
  const [d] = splitLocal(new Date().toISOString());
  const t = new Date(`${d}T12:00:00${TZ_OFFSET}`); const dow = t.getUTCDay();
  t.setUTCDate(t.getUTCDate() + ((8 - dow) % 7 || 7));
  return t.toISOString().slice(0, 10);
}
async function readGenRequest() {
  try { const f = await (await gh(`contents/requests/generate.json?${ref()}`)).json(); return { sha: f.sha, req: JSON.parse(b64decode(f.content)) }; }
  catch { return { sha: undefined, req: null }; }
}
function showGenStatus(req) {
  const box = $("#genStatus"); if (!box) return;
  if (!req || (req.status !== "requested" && req.at && Date.now() - new Date(req.at) > 3 * 864e5)) { box.hidden = true; return; }
  const when = req.at ? fmtTime(req.at) : "";
  box.hidden = false;
  box.className = `gen-status ${req.status}`;
  box.innerHTML = req.status === "requested" ? `⏳ 已送出：${esc(req.week)} 那週的內容，正在啟動寫稿…`
    : req.status === "started" ? `✨ ${esc(req.week)} 那週的內容已開始產生（${esc(when)}），約 20–30 分鐘後出現在 ① 內容審核。${req.session_url ? ` <a href="${esc(req.session_url)}" target="_blank" rel="noopener">查看進度</a>` : ""}`
    : `⚠️ 無法開始產生（${esc(when)}）：${esc(req.message || "")}`;
}
async function requestGenerate() {
  const week = prompt("要產生哪一週的內容？（那週的星期一，格式 YYYY-MM-DD）", nextMonday());
  if (week === null) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week) || new Date(`${week}T12:00:00${TZ_OFFSET}`).getUTCDay() !== 1) { toast("請輸入星期一的日期，例如 2026-11-30", true); return; }
  try {
    const { sha, req: old } = await readGenRequest();
    if (old && old.status === "requested") { toast("已經有一個請求在處理中", true); return; }
    const req = { week, status: "requested", requested_at: nowIso() };
    await gh(`contents/requests/generate.json`, { method: "PUT", body: JSON.stringify({ message: `Request content for week of ${week}`, content: b64encode(JSON.stringify(req, null, 2) + "\n"), branch: branch(), ...(sha ? { sha } : {}) }) });
    showGenStatus(req); toast("已送出，GitHub 正在啟動寫稿");
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 10000));
      const { req: now } = await readGenRequest();
      if (now && now.status !== "requested") { showGenStatus(now); return; }
    }
  } catch (e) { toast(e.message, true); }
}

// ---------- helpers ----------
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function toast(msg, isError = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = isError ? "error" : "";
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), isError ? 8000 : 3500);
}
function fmtTime(iso) {
  if (!iso) return "未設定時間";
  return new Date(iso).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false });
}
function mondayOf(iso) {
  if (!iso) return "";
  const d = new Date(new Date(iso).getTime() + 8 * 3600e3);
  const mon = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86400e3);
  return mon.toISOString().slice(0, 10);
}
function weekLabel(iso) {
  const m = mondayOf(iso);
  return m ? `${+m.slice(5, 7)}/${+m.slice(8, 10)} 這一週` : "未排定";
}
function splitLocal(iso) {
  if (!iso) return ["", ""];
  const d = new Date(new Date(iso).getTime() + 8 * 3600e3).toISOString();
  return [d.slice(0, 10), d.slice(11, 16)];
}
const nowIso = () => new Date().toISOString().slice(0, 19) + "Z";
function stamp(post, action, detail) {
  (post.history ||= []).push({ at: nowIso(), by: "dashboard", action, ...(detail ? { detail } : {}) });
}
function flatText(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(flatText).join("\n");
  if (typeof v === "object") return Object.values(v).map(flatText).join("\n");
  return String(v);
}
// Numbers worth cross-checking: decimals, percentages, years, money; ignores small counts like "5 個".
function numbersIn(text) {
  const out = new Set();
  for (const m of String(text).matchAll(/\d[\d,]*(?:\.\d+)?%?/g)) {
    const n = m[0].replace(/,/g, "");
    if (/^\d$/.test(n)) continue;
    out.add(n);
  }
  return out;
}
function reelText(rs) {
  if (!rs) return "";
  return [rs.topic, rs.hook, ...(rs.shots || []).flatMap((s) => [s.on_screen, s.voice])].join("\n");
}

// ---------- checks ----------
function lint(post, stage) {
  const issues = [];
  const P = (p) => PLATFORMS[p]?.label || p;
  for (const p of post.platforms || []) {
    const text = finalCaption(post, p);
    const max = PLATFORMS[p]?.max ?? Infinity;
    if (!text.trim()) issues.push(["bad", `${P(p)}：沒有文案`]);
    if ([...text].length > max) issues.push(["bad", `${P(p)}：超過 ${max} 字`]);
    for (const w of BANNED) if (text.toLowerCase().includes(w.toLowerCase())) issues.push(["bad", `${P(p)}：含禁用字詞「${w}」`]);
    if (/\d+(\.\d+)?\s*%/.test(text) && !/資料來源/.test(text)) issues.push(["warn", `${P(p)}：有數據但沒有「資料來源」`]);
  }
  const dt = flatText(post.design_text);
  for (const w of BANNED) if (dt.includes(w)) issues.push(["bad", `圖片文字含禁用字詞「${w}」`]);
  if (/____|0\.00%|00\.0/.test(dt)) issues.push(["bad", "圖片文字還有範本預留字（____ / 0.00% / 00.0）"]);
  if (!(post.platforms || []).length) issues.push(["bad", "沒有選擇平台"]);
  if (post.format === "reel") issues.push(...reelConsistency(post));
  if (stage === "final") {
    if (!(post.media || []).length) issues.push(["bad", "沒有圖片或影片"]);
    if (!post.publish_at) issues.push(["bad", "沒有設定發布時間"]);
    else if (new Date(post.publish_at) < new Date()) issues.push(["bad", "發布時間已經過了"]);
    else if (!/T\d\d:(00|30):00/.test(post.publish_at)) issues.push(["bad", "發布時間請選整點或半點（系統在 :00 和 :30 發布）"]);
    else { const hh = +splitLocal(post.publish_at)[1].slice(0, 2); if (hh < 10 || hh > 23) issues.push(["bad", "發布時間請在 10:00–23:30 之間（台北時間）"]); }
    if (post.format === "story") issues.push(["bad", "限動要在 IG App 手動發（投票／問答貼紙無法用 API 發布）"]);
  }
  issues.push(...duplicateIssues(post));
  const all = (dt + " " + Object.values(post.captions || {}).join(" ") + " " + (post.reel_script ? reelText(post.reel_script) : "")).replace(/\s+/g, "");
  (post.checks || []).forEach((c, i) => {
    const fixed = c.match && !all.includes(String(c.match).replace(/\s+/g, ""));
    issues.push(fixed ? ["done", `✓ 已修改：${c.message}`, i] : [c.level || "warn", `系統檢查：${c.message}`, i]);
  });
  return issues;
}
// Every number in a Reel script must also appear in that week's other posts.
function reelConsistency(post) {
  const nums = numbersIn(reelText(post.reel_script));
  if (!nums.size) return [];
  const week = mondayOf(post.publish_at);
  const others = posts.filter((x) => x.id !== post.id && mondayOf(x.post.publish_at) === week && x.post.status !== "rejected");
  const pool = new Set();
  for (const { post: o } of others) {
    for (const n of numbersIn(flatText(o.captions) + "\n" + flatText(o.design_text) + "\n" + flatText(o.sources))) pool.add(n);
  }
  const missing = [...nums].filter((n) => !pool.has(n));
  return missing.length ? [["bad", `腳本裡的數字 ${missing.join("、")} 沒有出現在本週其他貼文，請核對或補上來源`]] : [];
}

// ---------- list view ----------
let postLog = [];
async function readLog() {
  try { return JSON.parse(b64decode((await (await gh(`contents/drafting/post-log.json?${ref()}`)).json()).content)); } catch { return []; }
}
// Character-pair (bigram) similarity, 0..1, ignoring spaces, punctuation and emoji.
function similarity(a, b) {
  const norm = (s) => [...String(s || "").replace(/[\s\p{P}\p{S}\p{Extended_Pictographic}]/gu, "")];
  const grams = (s) => { const c = norm(s), m = new Map(); for (let i = 0; i < c.length - 1; i++) { const g = c[i] + c[i + 1]; m.set(g, (m.get(g) || 0) + 1); } return m; };
  const A = grams(a), B = grams(b); let both = 0, na = 0, nb = 0;
  for (const v of A.values()) na += v; for (const v of B.values()) nb += v;
  for (const [g, v] of A) both += Math.min(v, B.get(g) || 0);
  return na + nb ? (2 * both) / (na + nb) : 0;
}
function coverLine(p) { const pg = (p.design_text || [])[0]; return pg && typeof pg.text === "string" ? (pg.text.split("\n").find((l) => l.trim()) || "") : ""; }
function firstCaption(p) { const c = (p.captions || {}); return (String(c.instagram || c.facebook || "").split("\n").find((l) => l.trim()) || ""); }
function duplicateIssues(post) {
  const mine = [["封面", coverLine(post)], ["文案開頭", firstCaption(post)]].filter(([, t]) => [...t].length >= 6);
  const others = [...postLog.map((e) => ({ id: e.id, date: e.date, cover: e.cover, cap: e.first_caption_line })),
    ...posts.filter((x) => x.id !== post.id && x.post.status !== "rejected").map((x) => ({ id: x.id, date: (x.post.publish_at || "").slice(0, 10), cover: coverLine(x.post), cap: firstCaption(x.post) }))];
  const out = [];
  for (const [what, text] of mine) {
    let best = null;
    for (const o of others) { const s = Math.max(similarity(text, o.cover), similarity(text, o.cap)); if (s >= 0.6 && (!best || s > best.s)) best = { ...o, s }; }
    if (best) out.push(["warn", `可能和 ${best.date} 的貼文重複（${what}相似度 ${Math.round(best.s * 100)}%）：同主題可以，內容和角度要換`]);
  }
  return out;
}
async function readCfg(name) {
  try { return JSON.parse(b64decode((await (await gh(`contents/config/${name}.json?${ref()}`)).json()).content)); } catch { return {}; }
}
async function refreshList() {
  $("#listMsg").textContent = "載入中…";
  $("#postList").innerHTML = "";
  try {
    const [ps, b, t, lg] = await Promise.all([listPosts(), readCfg("brand"), readCfg("templates"), readLog()]);
    posts = ps; siteCfg = { brand: b, templates: t }; postLog = Array.isArray(lg) ? lg : [];
    readGenRequest().then(({ req }) => showGenStatus(req));
  } catch (e) {
    $("#listMsg").textContent = e.message;
    return;
  }
  renderList();
}
function renderList() {
  const allowed = FILTERS[filter];
  const shown = posts.filter((p) => !allowed || allowed.includes(p.post.status));
  for (const b of document.querySelectorAll("#tabs button[data-filter]")) {
    const a = FILTERS[b.dataset.filter];
    const n = posts.filter((p) => !a || a.includes(p.post.status)).length;
    b.querySelector("span")?.remove();
    if (n && b.dataset.filter !== "all") b.insertAdjacentHTML("beforeend", `<span class="count">${n}</span>`);
  }
  $("#listMsg").textContent = shown.length ? "" : "這裡目前沒有貼文。";
  let html = "", lastWeek = "";
  for (const { id, post } of shown) {
    const wk = weekLabel(post.publish_at);
    if (wk !== lastWeek) { html += `<div class="week">${esc(wk)}</div>`; lastWeek = wk; }
    html += `<div class="post-card" data-id="${esc(id)}">
      <div class="thumb" data-thumb="${esc(id)}">${esc(post.format === "reel" ? "Reel" : post.format === "story" ? "限動" : "")}</div>
      <div><div class="title">${esc(post.series || id)}</div>
        <div class="meta">${esc(fmtTime(post.publish_at))} · ${esc(post.format)} · ${esc((post.platforms || []).map((p) => PLATFORMS[p]?.label || p).join(" / "))}</div>
        <div class="meta">${esc(post.theme || "")}</div></div>
      <span class="chip ${esc(post.status)}">${esc(STATUS[post.status] || post.status)}</span></div>`;
  }
  $("#postList").innerHTML = html;
  for (const el of document.querySelectorAll(".post-card")) el.onclick = () => openPost(el.dataset.id);
  for (const { id, post } of shown) {
    const first = (post.media || []).find((n) => /\.(png|jpe?g)$/i.test(n));
    if (!first) continue;
    gh(`contents/posts/${id}/${encodeURIComponent(first)}?${ref()}`, { headers: { Accept: "application/vnd.github.raw" } })
      .then((r) => r.blob())
      .then((b) => {
        const holder = document.querySelector(`[data-thumb="${CSS.escape(id)}"]`);
        if (holder) holder.outerHTML = `<img class="thumb" alt="" src="${URL.createObjectURL(b)}">`;
      })
      .catch(() => {});
  }
}

// ---------- detail view ----------
async function openPost(id) {
  const entry = posts.find((p) => p.id === id);
  if (!entry) return;
  $("#listView").hidden = true;
  $("#detailView").hidden = false;
  $("#detail").innerHTML = `<p class="muted">載入中…</p>`;
  window.scrollTo(0, 0);
  try {
    current = { ...entry, post: structuredClone(entry.post), media: await loadMedia(id, entry.post) };
  } catch (e) {
    $("#detail").innerHTML = `<p>${esc(e.message)}</p>`;
    return;
  }
  activePlatform = (current.post.platforms || [])[0] || "instagram";
  renderDetail();
}

const stageOf = (s) => (s === "content_review" ? "content" : ["design_review", "failed", "changed_after_approval", "missed"].includes(s) ? "final" : "other");

function scriptText(p) {
  return (p.design_text || []).map((pg, i) => `P${i + 1}｜${pg.name || ""}\n\n${pg.text || ""}`).join("\n\n");
}

function scriptPanel(p, editable) {
  const dis = editable ? "" : "disabled";
  const body = p.design_text.map((pg, i) => `<fieldset class="dt-page"><legend>P${i + 1}｜<input class="pname" data-dt="${i}.name" value="${esc(pg.name || "")}" ${dis}></legend>
      <textarea data-dt="${i}.text" class="script" rows="${Math.max(4, String(pg.text || "").split("\n").length + 1)}" ${dis}>${esc(pg.text || "")}</textarea>
      ${editable ? `<div style="text-align:right"><button type="button" class="ghost danger" data-delpage="${i}">刪除這一頁</button></div>` : ""}</fieldset>`).join("");
  const help = `<p class="muted" style="margin-top:0">每頁第一行是標題。emoji 開頭＝段落標題；✔ 條列；・ 子項目；①② 步驟；💡／👉 底部重點；⚠️ 提醒；**粗體**；封面用「」標出大字。</p>`;
  return editable
    ? `<div class="panel"><h3>貼文內容（逐頁）</h3>${help}${body}<div class="row" style="flex-wrap:wrap"><button type="button" id="addPage">＋ 新增頁</button><button type="button" id="copyAll" class="ghost">複製全文</button></div></div>`
    : `<details class="panel"><summary><h3>貼文內容（已核准）</h3></summary>${body}<button type="button" id="copyAll" class="ghost">複製全文</button></details>`;
}

const THEME_OPTS = [["", "自動（依主題）"], ["navy", "深藍＋香檳金"], ["blue", "藍＋淺灰白"], ["charcoal", "炭黑＋陶土橘"]];
function themePanel(p, stage) {
  if (p.production !== "auto" || !Array.isArray(p.design_text) || !p.design_text.length) return "";
  if (stage !== "content" && stage !== "final") return "";
  const cur = ["navy", "blue", "charcoal"].includes(p.template) ? p.template : "";
  const auto = (siteCfg.templates?.pillar_theme || {})[p.pillar] || "navy";
  const autoName = THEME_OPTS.find(([k]) => k === auto)?.[1] || auto;
  return `<div class="panel"><h3>配色</h3><select id="fTheme">${THEME_OPTS.map(([k, v]) => `<option value="${k}" ${k === cur ? "selected" : ""}>${esc(k ? v : `${v}：${autoName}`)}</option>`).join("")}</select>
    <small class="muted">${stage === "content" ? "換了預覽會馬上更新，按「儲存修改」或核准時一起存。" : "換配色會重新產生圖片（約 2–3 分鐘），完成後回到成品審核。"}</small></div>`;
}

function autosize(el) { if (!el.offsetParent) return; el.style.height = "auto"; el.style.height = el.scrollHeight + 2 + "px"; }

function designTextPanel(p, editable) {
  if (!Array.isArray(p.design_text) || !p.design_text.length) return "";
  if (p.design_text.some((pg) => typeof pg.text === "string")) return scriptPanel(p, editable);
  const dis = editable ? "" : "disabled";
  const input = (path, val) => `<input data-dt="${path}" value="${esc(val)}" ${dis}><small class="muted">${[...String(val || "")].length} 字</small>`;
  const area = (path, val) => `<textarea data-dt="${path}" rows="3" style="min-height:0" ${dis}>${esc(val)}</textarea><small class="muted">${[...String(val || "")].length} 字</small>`;
  let html = editable
    ? `<div class="panel"><h3>圖片上的文字</h3><p class="muted" style="margin-top:0">字數請盡量符合範本限制；清空的項目會在製作時刪掉。</p>`
    : `<details class="panel"><summary><h3>圖片上的文字（已核准）</h3></summary><p class="muted">要改圖片上的字，請按「在 Canva 編輯設計」，改完再按「重新匯出」。</p>`;
  p.design_text.forEach((pg, i) => {
    const KIND = { cover: "封面", table: "表格", list: "條列", flow: "流程", checklist: "清單", cta: "行動呼籲" };
    html += `<fieldset class="dt-page"><legend>第 ${i + 1} 頁 · ${esc(KIND[pg.kind] || pg.kind || pg.role || "")}</legend>`;
    for (const [k, v] of Object.entries(pg)) {
      if (k === "page" || k === "role" || k === "kind") continue;
      const label = FIELD_LABELS[k] || k;
      if (typeof v === "string") html += `<label>${esc(label)}${input(`${i}.${k}`, v)}</label>`;
      else if (v && typeof v === "object" && !Array.isArray(v)) {
        html += `<div class="dt-list"><div class="dt-list-label">${esc(label)}</div><div class="row dt-item">${Object.entries(v).map(([kk, vv]) => `<label>${esc(FIELD_LABELS[kk] || kk)}${input(`${i}.${k}.${kk}`, vv)}</label>`).join("")}</div></div>`;
      }
      else if (Array.isArray(v)) {
        html += `<div class="dt-list"><div class="dt-list-label">${esc(label)}</div>`;
        v.forEach((item, j) => {
          if (typeof item === "string") html += k === "paragraphs"
            ? `<label>${esc(label)} ${j + 1}${area(`${i}.${k}.${j}`, item)}</label>`
            : `<label class="inline">${j + 1}.${input(`${i}.${k}.${j}`, item)}</label>`;
          else html += `<div class="row dt-item">${Object.entries(item).map(([kk, vv]) => `<label>${esc(FIELD_LABELS[kk] || kk)}${input(`${i}.${k}.${j}.${kk}`, vv)}</label>`).join("")}</div>`;
        });
        html += `</div>`;
      }
    }
    html += `</fieldset>`;
  });
  return html + (editable ? `</div>` : `</details>`);
}

function reelPanel(p, editable) {
  const rs = p.reel_script;
  if (!rs) return "";
  const dis = editable ? "" : "disabled";
  return `<${editable ? "div" : "details open"} class="panel"><${editable ? "h3" : "summary"}>Reel 腳本（手動拍攝）</${editable ? "h3" : "summary"}>
    <label>主題<input data-rs="topic" value="${esc(rs.topic)}" ${dis}></label>
    <label>開頭鉤子（第一秒要看得懂）<input data-rs="hook" value="${esc(rs.hook)}" ${dis}></label>
    <label>長度（秒）<input data-rs="duration_s" type="number" min="10" max="90" value="${esc(rs.duration_s)}" ${dis}></label>
    ${(rs.shots || []).map((s, i) => `<fieldset class="dt-page"><legend>鏡頭 ${esc(s.s ?? i + 1)}</legend>
      <label>畫面<input data-shot="${i}.visual" value="${esc(s.visual)}" ${dis}></label>
      <label>字幕／畫面文字<input data-shot="${i}.on_screen" value="${esc(s.on_screen)}" ${dis}></label>
      <label>口白<textarea data-shot="${i}.voice" rows="2" style="min-height:0" ${dis}>${esc(s.voice)}</textarea></label></fieldset>`).join("")}
    ${rs.caption_note ? `<p class="muted">${esc(rs.caption_note)}</p>` : ""}</${editable ? "div" : "details"}>`;
}

function renderDetail(selectedMedia = 0) {
  const p = current.post;
  const stage = stageOf(p.status);
  const editable = stage !== "other" || p.status === "ready_to_film";
  const textEditable = stage === "content";
  const names = p.media || [];
  const name = names[selectedMedia];
  const m = name ? current.media[name] : null;
  const isVideo = name && /\.(mp4|mov)$/i.test(name);
  const vertical = ["reel", "story"].includes(p.format);
  const [date, time] = splitLocal(p.publish_at);
  const issues = lint(p, stage === "content" ? "content" : "final");

  const mediaPanel = names.length ? `<div class="panel">
      ${m?.url ? (isVideo
        ? `<video class="media-main vertical" src="${m.url}" controls playsinline></video>`
        : `<img class="media-main ${vertical ? "vertical" : ""}" src="${m.url}" alt="${esc(name)}">`)
        : `<div class="media-main empty">找不到檔案</div>`}
      <div class="media-strip">${names.length > 1 ? names.map((n, i) => current.media[n]?.url && !/\.(mp4|mov)$/i.test(n)
        ? `<img src="${current.media[n].url}" data-i="${i}" class="${i === selectedMedia ? "active" : ""}" alt="${i + 1}">` : "").join("") : ""}</div>
      <p class="muted" style="margin:8px 0 0">${names.length} 個檔案 · ${esc(p.format)}
</p>
    </div>` : `<div class="panel"><p class="muted" style="margin:0">${stage === "content"
      ? "內容核准後，系統會自動產生圖片（約 2–3 分鐘），完成後出現在 ③ 成品審核。"
      : p.format === "reel" ? "拍好後在下方上傳影片。" : "尚無圖片。"}</p></div>`;

  const uploadPanel = p.status === "ready_to_film" || (p.format === "reel" && stage === "final") ? `<div class="panel">
      <h3>上傳 Reel 影片</h3>
      <input type="file" id="videoFile" accept="video/mp4,video/quicktime">
      <small class="muted">MP4 或 MOV，95 MB 以內，直式 9:16。上傳後進入成品審核。</small>
      <div style="margin-top:8px"><button type="button" id="uploadBtn">上傳</button></div></div>` : "";

  $("#detail").innerHTML = `
  <div class="stage-bar">
    <span class="${stage === "content" ? "on" : ""}">① 內容審核</span>
    <span class="${["content_approved", "ready_to_film", "needs_export"].includes(p.status) ? "on" : ""}">② 製作</span>
    <span class="${stage === "final" ? "on" : ""}">③ 成品審核</span>
    <span class="${p.status === "approved" ? "on" : ""}">④ 排程</span>
  </div>
  <div class="detail-grid">
    <div>
      ${stage === "content" && Array.isArray(p.design_text) && p.design_text.length ? `<div class="panel"><h3>圖片即時預覽</h3><p class="muted" style="margin-top:0">邊改邊看；核准內容後會依這個樣子產生圖片。</p><div class="pv" id="pv"></div></div>` : mediaPanel}
      ${uploadPanel}
      <div class="panel">
        <h3>檢查</h3>
        ${issues.length ? `<ul class="checks">${issues.map(([lvl, msg, ci]) => `<li class="${lvl}">${esc(msg)}${ci !== undefined && editable ? ` <button type="button" class="ghost resolve" data-resolve="${ci}">標記已處理</button>` : ""}</li>`).join("")}</ul>` : `<p class="muted" style="margin:0">沒有發現問題</p>`}
      </div>
      ${(p.sources || []).length ? `<div class="panel"><h3>資料來源</h3><ul class="checks">${p.sources.map((s) =>
        `<li>${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a>` : esc(s.name)} ${esc(s.date || "")}${s.note ? ` — ${esc(s.note)}` : ""}</li>`).join("")}</ul></div>` : ""}
    </div>

    <div>
      <div class="panel">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:start">
          <div><h3 style="margin:0">${esc(p.series || p.id)}</h3><div class="muted">${esc(p.theme || "")} · ${esc(p.pillar || "")}</div></div>
          <span class="chip ${esc(p.status)}">${esc(STATUS[p.status] || p.status)}</span>
        </div>
        ${p.review_notes ? `<p class="muted">備註：${esc(p.review_notes)}</p>` : ""}
      </div>

      ${themePanel(p, stage)}
      ${designTextPanel(p, textEditable)}
      ${reelPanel(p, textEditable)}

      <div class="panel">
        <h3>發布時間與平台（台北時間）</h3>
        <div class="row">
          <label>日期<input type="date" id="fDate" value="${date}" ${editable ? "" : "disabled"}></label>
          <label>時間<input type="time" id="fTime" step="1800" min="10:00" max="23:30" value="${time}" ${editable ? "" : "disabled"}></label>
          ${editable ? `<button type="button" id="randTime" class="ghost" style="flex:0 0 auto;align-self:end;margin-bottom:10px" title="同一天 10:00–23:30 隨機挑一個整點或半點">🎲 隨機時間</button>` : ""}
        </div>
        <div class="row">${Object.entries(PLATFORMS).map(([k, v]) => `<label style="flex:0 0 auto;font-weight:400">
          <input type="checkbox" data-platform="${k}" style="width:auto" ${(p.platforms || []).includes(k) ? "checked" : ""} ${editable ? "" : "disabled"}> ${v.label}</label>`).join("")}</div>
      </div>

      <div class="panel">
        <h3>${p.format === "story" ? "限動文字（投票／問答）" : "文案"}</h3>
        <div class="platform-tabs">${(p.platforms || []).map((k) => `<button type="button" data-tab="${k}" class="${k === activePlatform ? "active" : ""}">${PLATFORMS[k]?.label || k}</button>`).join("")}</div>
        ${(p.platforms || []).includes(activePlatform) ? `
          <textarea id="fCaption" ${editable ? "" : "disabled"}>${esc((p.captions || {})[activePlatform] || "")}</textarea>
          <div class="counter" id="fCounter"></div>
          <label>Hashtags（空格分隔）<input id="fTags" value="${esc(((p.hashtags || {})[activePlatform] || []).join(" "))}" ${editable ? "" : "disabled"}></label>
          <h3 style="margin-top:12px">實際發布內容預覽</h3>
          <div class="preview" id="fPreview"></div>` : `<p class="muted">先勾選至少一個平台。</p>`}
      </div>

      ${Object.keys(p.results || {}).length ? `<div class="panel"><h3>發布結果</h3><ul class="checks">${Object.entries(p.results).map(([k, r]) =>
        `<li>${PLATFORMS[k]?.label || k}：${r.permalink ? `<a href="${esc(r.permalink)}" target="_blank" rel="noopener">查看貼文</a>` : esc(r.id)} ${esc(r.at || "")}</li>`).join("")}</ul></div>` : ""}

      <div class="panel"><h3>紀錄</h3><ul class="history">${(p.history || []).slice(-8).reverse().map((h) =>
        `<li>${esc(h.at)} · ${esc(h.by)} · ${esc(h.action)}${h.detail ? ` — ${esc(h.detail)}` : ""}</li>`).join("")}</ul></div>

      <div class="actions">
        ${editable ? `<button type="button" data-act="save">儲存修改</button>` : ""}
        ${stage === "content" ? `<button type="button" data-act="approveContent" class="gold">核准內容，開始製作</button>` : ""}
        ${p.status === "content_approved" ? `<button type="button" data-act="backToContent">撤回，改回內容審核</button>` : ""}
        ${stage === "final" && p.production === "auto" ? `<button type="button" data-act="backToContent">退回修改圖片文字</button>` : ""}
        ${stage === "final" ? `<button type="button" data-act="approve" class="gold">核准成品並排程</button>` : ""}
        ${p.status === "approved" ? `<button type="button" data-act="unschedule">取消排程</button>` : ""}
        ${stage !== "other" || ["content_approved", "ready_to_film"].includes(p.status) ? `<button type="button" data-act="reject" class="danger ghost">退回</button>` : ""}
        <button type="button" data-act="delete" class="danger ghost">🗑 刪除</button>
      </div>
    </div>
  </div>`;

  for (const img of document.querySelectorAll(".media-strip img")) img.onclick = () => { collectForm(); renderDetail(+img.dataset.i); };
  for (const b of document.querySelectorAll("[data-tab]")) b.onclick = () => { collectForm(); activePlatform = b.dataset.tab; renderDetail(selectedMedia); };
  for (const c of document.querySelectorAll("[data-platform]")) c.onchange = () => {
    collectForm();
    if (!p.platforms.includes(activePlatform)) activePlatform = p.platforms[0];
    renderDetail(selectedMedia);
  };
  const cap = $("#fCaption"), tags = $("#fTags");
  if (cap) { cap.oninput = tags.oninput = updatePreview; updatePreview(); }
  if ($("#pv")) {
    drawPreview();
    for (const el of document.querySelectorAll("[data-dt]")) el.addEventListener("input", () => { clearTimeout(drawPreview.t); drawPreview.t = setTimeout(() => { collectForm(); drawPreview(); }, 400); });
  }
  for (const b of document.querySelectorAll("[data-act]")) b.onclick = () => act(b.dataset.act);
  for (const b of document.querySelectorAll("[data-resolve]")) b.onclick = () => {
    const c = (p.checks || [])[+b.dataset.resolve]; if (!c) return;
    if (!confirm(`把這條檢查標記為已處理？\n\n${c.message}\n\n（按「儲存修改」或核准時一起存，紀錄會留下）`)) return;
    collectForm(); p.checks.splice(+b.dataset.resolve, 1); stamp(p, "check resolved by reviewer", c.message); renderDetail();
  };
  $("#uploadBtn")?.addEventListener("click", uploadVideo);
  $("#randTime")?.addEventListener("click", () => { $("#fTime").value = randomSlot(); collectForm(); renderDetail(selectedMedia); toast(`時間改為 ${$("#fTime").value}，記得儲存或核准`); });
  $("#addPage")?.addEventListener("click", () => { collectForm(); const pg = p.design_text; pg.splice(Math.max(pg.length - 1, 1), 0, { name: "新頁", text: "標題\n\n💡 重點" }); renderDetail(); });
  for (const b of document.querySelectorAll("[data-delpage]")) b.onclick = () => { if (!confirm("刪除這一頁？")) return; collectForm(); p.design_text.splice(+b.dataset.delpage, 1); renderDetail(); };
  for (const ta of document.querySelectorAll("textarea.script, #fCaption")) { autosize(ta); ta.addEventListener("input", () => autosize(ta)); }
  for (const d of document.querySelectorAll("details.panel")) d.addEventListener("toggle", () => d.querySelectorAll("textarea").forEach(autosize));
  $("#fTheme")?.addEventListener("change", async (e) => {
    const v = e.target.value;
    if (stage === "content") { if (v) p.template = v; else delete p.template; collectForm(); drawPreview(); return; }
    if (!confirm("換配色後會重新產生圖片，約 2–3 分鐘後回到成品審核。確定？")) { e.target.value = ["navy", "blue", "charcoal"].includes(p.template) ? p.template : ""; return; }
    collectForm();
    if (v) p.template = v; else delete p.template;
    p.status = "content_approved"; delete p.approval; stamp(p, "theme changed", v || "auto");
    try { await savePost(current, `Change theme ${current.id} → ${v || "auto"}`); toast("已送出重新製作圖片"); syncList(); renderDetail(); }
    catch (err) { toast(err.message, true); }
  });
  $("#copyAll")?.addEventListener("click", async () => { collectForm(); try { await navigator.clipboard.writeText(scriptText(p)); toast("已複製全文"); } catch { toast("無法複製，請手動選取", true); } });
}

function drawPreview() {
  const box = $("#pv"); if (!box) return;
  let htmls = [];
  try { htmls = postPages(current.post, siteCfg.brand, siteCfg.templates); } catch (e) { box.textContent = "預覽失敗：" + e.message; return; }
  const old = box.querySelectorAll("iframe");
  if (old.length !== htmls.length) box.innerHTML = htmls.map(() => `<div class="pvf"><iframe sandbox="allow-scripts" scrolling="no"></iframe></div>`).join("");
  box.querySelectorAll("iframe").forEach((f, i) => {
    if (f.srcdoc !== htmls[i]) f.srcdoc = htmls[i];
    f.style.transform = `scale(${f.parentElement.clientWidth / 1080})`;
  });
}
window.addEventListener("resize", () => drawPreview());

function setPath(obj, path, val) {
  const keys = path.split(".");
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) o = o[/^\d+$/.test(keys[i]) ? +keys[i] : keys[i]];
  const last = keys.at(-1);
  o[/^\d+$/.test(last) ? +last : last] = val;
}

function collectForm() {
  const p = current.post;
  const d = $("#fDate")?.value, t = $("#fTime")?.value;
  if (d && t) p.publish_at = `${d}T${t}:00${TZ_OFFSET}`;
  if (document.querySelector("[data-platform]")) {
    p.platforms = [...document.querySelectorAll("[data-platform]")].filter((c) => c.checked).map((c) => c.dataset.platform);
  }
  p.captions ||= {}; p.hashtags ||= {};
  for (const k of p.platforms || []) {
    if (!(k in p.captions)) p.captions[k] = p.captions.instagram || "";
    if (!(k in p.hashtags)) p.hashtags[k] = [...(p.hashtags.instagram || [])];
  }
  const cap = $("#fCaption");
  if (cap && activePlatform) {
    p.captions[activePlatform] = cap.value;
    p.hashtags[activePlatform] = $("#fTags").value.split(/\s+/).filter(Boolean).map((x) => (x.startsWith("#") ? x : `#${x}`));
  }
  for (const el of document.querySelectorAll("[data-dt]:not([disabled])")) setPath(p.design_text, el.dataset.dt, el.value);
  for (const el of document.querySelectorAll("[data-rs]:not([disabled])")) p.reel_script[el.dataset.rs] = el.dataset.rs === "duration_s" ? +el.value : el.value;
  for (const el of document.querySelectorAll("[data-shot]:not([disabled])")) setPath(p.reel_script.shots, el.dataset.shot, el.value);
}

function updatePreview() {
  collectForm();
  const text = finalCaption(current.post, activePlatform);
  const max = PLATFORMS[activePlatform]?.max ?? Infinity;
  const n = [...text].length;
  const counter = $("#fCounter");
  counter.textContent = `${n} / ${max} 字（含 hashtags）`;
  counter.className = "counter" + (n > max ? " over" : "");
  $("#fPreview").textContent = text;
}

const changedFromSaved = () => JSON.stringify(posts.find((x) => x.id === current.id).post) !== JSON.stringify(current.post);

async function confirmDialog(title, html) {
  $("#confirmTitle").textContent = title;
  $("#confirmBody").innerHTML = html;
  const dlg = $("#confirmDlg");
  dlg.showModal();
  return new Promise((r) => dlg.addEventListener("close", () => r(dlg.returnValue === "ok"), { once: true }));
}

async function uploadVideo() {
  const f = $("#videoFile")?.files?.[0];
  if (!f) { toast("請先選擇影片檔", true); return; }
  if (f.size > MAX_UPLOAD) { toast("影片超過 95 MB，請先壓縮再上傳", true); return; }
  collectForm();
  const name = /\.mov$/i.test(f.name) ? "reel.mov" : "reel.mp4";
  try {
    toast("上傳中…（大檔案需要一點時間）");
    await uploadFile(current.id, name, f);
    const p = current.post;
    p.media = [name];
    p.status = "design_review";
    delete p.approval;
    stamp(p, "video uploaded", `${(f.size / 1048576).toFixed(1)} MB`);
    await savePost(current, `Reel video for ${current.id}`);
    current.media = await loadMedia(current.id, p);
    syncList();
    toast("影片已上傳，進入成品審核");
    renderDetail();
  } catch (e) {
    toast(e.message, true);
  }
}

function syncList() {
  const idx = posts.findIndex((x) => x.id === current.id);
  posts[idx] = { id: current.id, post: structuredClone(current.post), sha: current.sha };
}

async function act(kind) {
  collectForm();
  const p = current.post;
  try {
    if (kind === "approveContent" || kind === "approve") {
      const issues = lint(p, kind === "approve" ? "final" : "content");
      const blocking = issues.filter(([lvl]) => lvl === "bad");
      if (blocking.length) { toast("請先處理：" + blocking.map(([, m]) => m).join("、"), true); renderDetail(); return; }
      const warnings = issues.filter(([lvl]) => lvl === "warn");
      const warnHtml = warnings.length ? `<ul class="checks">${warnings.map(([, m]) => `<li class="warn">${esc(m)}</li>`).join("")}</ul>` : "";
      if (kind === "approveContent") {
        const ok = await confirmDialog("核准內容", `<p>核准後系統會依這份文字${p.format === "reel" ? "標記為「等待拍攝」" : "自動產生圖片（約 2–3 分鐘）"}。之後還會有一次成品審核。</p>${warnHtml}`);
        if (!ok) return;
        p.status = "content_approved";
        stamp(p, "content approved");
        await savePost(current, `Approve content ${current.id}`);
        toast("內容已核准");
      } else {
        const ok = await confirmDialog("確認排程", `
          <p><strong>${esc(fmtTime(p.publish_at))}</strong>（台北時間）發布到 <strong>${esc(p.platforms.map((k) => PLATFORMS[k].label).join("、"))}</strong>。</p>
          <p class="muted">會發布你現在看到的檔案與文案。核准後若再修改任何內容，系統會停止發布並要求重新核准。</p>${warnHtml}`);
        if (!ok) return;
        const files = await (await gh(`contents/posts/${current.id}?${ref()}`)).json();
        const shas = Object.fromEntries(files.map((f) => [f.name, f.sha]));
        const missing = (p.media || []).filter((n) => !shas[n]);
        if (missing.length) { toast(`找不到檔案：${missing.join(", ")}`, true); return; }
        if (Object.entries(current.media).some(([n, mm]) => mm.sha && shas[n] !== mm.sha)) {
          toast("檔案在你檢視後被更新了，請重新開啟這篇再核准。", true); return;
        }
        p.status = "approved";
        p.approval = { at: nowIso(), hash: await approvalHash(p, shas) };
        stamp(p, "approved", `${p.publish_at} → ${p.platforms.join(", ")}`);
        await savePost(current, `Approve ${current.id} for ${p.publish_at}`);
        toast("已核准並排程");
      }
    } else if (kind === "save") {
      if (!changedFromSaved()) { toast("沒有需要儲存的修改"); return; }
      if (p.status === "approved") { p.status = "design_review"; delete p.approval; stamp(p, "edited", "edited after approval; needs approval again"); }
      else stamp(p, "edited");
      await savePost(current, `Edit ${current.id}`);
      toast("已儲存");
    } else if (kind === "backToContent") {
      p.status = "content_review"; delete p.approval; stamp(p, "back to content review");
      await savePost(current, `Withdraw content approval ${current.id}`);
      toast("已改回內容審核");
    } else if (kind === "unschedule") {
      p.status = "design_review"; delete p.approval; stamp(p, "unscheduled");
      await savePost(current, `Unschedule ${current.id}`);
      toast("已取消排程");
    } else if (kind === "delete") {
      const note = p.status === "published" ? "\n\n（只刪除系統裡的紀錄，已發布到 IG／FB 的貼文不會被刪除。）" : p.status === "approved" ? "\n\n排程會一起取消，這篇不會發布。" : "";
      if (!confirm(`永久刪除這篇？\n\n${p.series || ""}｜${fmtTime(p.publish_at)}${note}`)) return;
      await deletePost(current.id);
      posts = posts.filter((x) => x.id !== current.id);
      current = null;
      $("#detailView").hidden = true; $("#listView").hidden = false; renderList();
      toast("已刪除");
      return;
    } else if (kind === "reject") {
      const reason = prompt("退回原因（下次寫稿會參考）：", "");
      if (reason === null) return;
      p.status = "rejected"; delete p.approval; p.review_notes = reason; stamp(p, "rejected", reason);
      await savePost(current, `Reject ${current.id}`);
      toast("已退回");
    }
    syncList();
    renderDetail();
  } catch (e) {
    toast(e.status === 409 ? "這篇在別處被更新了，請返回列表重新開啟。" : e.message, true);
  }
}

// ---------- wiring ----------
$("#tabs").onclick = (e) => {
  const b = e.target.closest("button[data-filter]");
  if (!b) return;
  filter = b.dataset.filter;
  for (const x of document.querySelectorAll("#tabs button")) x.classList.toggle("active", x === b);
  renderList();
};
$("#refreshBtn").onclick = () => refreshList();
$("#newBtn").onclick = () => openNewPost();
$("#genBtn").onclick = () => requestGenerate();
$("#backBtn").onclick = () => {
  if (current && changedFromSaved() && !confirm("有未儲存的修改，確定離開？")) return;
  current = null;
  $("#detailView").hidden = true;
  $("#listView").hidden = false;
  renderList();
};
function openSettings() {
  const f = $("#settingsForm");
  f.repo.value = cfg.repo || "vivian0219yy/auspacific-social"; f.branch.value = cfg.branch || "main"; f.token.value = cfg.token || "";
  $("#settingsDlg").showModal();
}
$("#settingsBtn").onclick = openSettings;
$("#settingsDlg").addEventListener("close", () => {
  if ($("#settingsDlg").returnValue !== "save") return;
  const f = $("#settingsForm");
  saveCfg({ repo: f.repo.value.trim(), branch: f.branch.value.trim() || "main", token: f.token.value.trim() });
  refreshList();
});

if (cfg.repo && cfg.token) refreshList();
else { $("#listMsg").textContent = "請先到「設定」連接 GitHub repo。"; openSettings(); }
