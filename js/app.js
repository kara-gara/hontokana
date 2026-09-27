// UI層：画面の切り替えと描画だけを担当する。判定ロジックは engine.js、キャラクターは mascot.js。
import { ANSWERS, beliefScore, createEngine } from "./engine.js";
import { guessText, line, mountMascot, setMood } from "./mascot.js";

const DATA_URL = "data/items.json";
const ZUKAN_KEY = "hontokana.zukan.v1";
const THINK_MS = 520;
const REACT_MS = 1300;

const GUESS_ANSWERS = [
  { label: "当たり！", belief: 1, cls: "g-hit" },
  { label: "ちょっと当たり", belief: 0.5, cls: "g-half" },
  { label: "わからない", belief: 0, cls: "g-unk" },
  { label: "ハズレ", belief: -1, cls: "g-miss" },
];

const $ = (id) => document.getElementById(id);
const screens = ["start", "question", "result", "error"];
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const wait = (ms) => new Promise((r) => setTimeout(r, reducedMotion ? 0 : ms));

let data = null;
let engine = null;
let step = null;   // { item, mode, confidence }
let busy = false;  // 演出中は入力を受け付けない
let guessRun = { hit: 0, miss: 0 }; // 予想の連続的中・連続ハズレ

function show(name) {
  for (const s of screens) $(`screen-${s}`).hidden = s !== name;
  window.scrollTo({ top: 0 });
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(c));
  }
  return node;
}

// ---------- 図鑑（ブラウザ内だけの保存。使えない環境でも動くようにする） ----------

function loadZukan() {
  try { return new Set(JSON.parse(localStorage.getItem(ZUKAN_KEY)) || []); } catch { return new Set(); }
}
function saveZukan(set) {
  try { localStorage.setItem(ZUKAN_KEY, JSON.stringify([...set])); } catch { /* 保存できなくても続行 */ }
}

// ---------- 質問 ----------

const mascotQ = () => $("mascot-q");

function setCard({ aside = "", text = "", mode = "question", note = "" }) {
  const card = $("q-card");
  card.className = `q-card mode-${mode}`;
  $("q-aside").textContent = aside;
  $("q-note").textContent = note;
  $("q-note").hidden = !note;
  $("q-text").textContent = text;
  void card.offsetWidth;
  card.classList.add("pop");
}

function setButtons(mode) {
  const wrap = $("answers");
  wrap.className = `answers answers-${mode}`;
  if (mode === "guess") {
    wrap.replaceChildren(...GUESS_ANSWERS.map((g, i) =>
      el("button", { type: "button", class: `ans ${g.cls}`, onclick: () => onGuess(g.belief) },
        el("span", { class: "ans-num", "aria-hidden": "true" }, String(i + 1)), g.label)));
  } else {
    wrap.replaceChildren(...ANSWERS.map((a, i) =>
      el("button", { type: "button", class: `ans ans-${a.key}`, onclick: () => onAnswer(a.key) },
        el("span", { class: "ans-num", "aria-hidden": "true" }, String(i + 1)), a.label)));
  }
}

function setBusy(v) {
  busy = v;
  for (const b of $("answers").querySelectorAll("button")) b.disabled = v;
  $("btn-back").disabled = v || engine.askedCount === 0;
}

function updateMeters() {
  $("q-count").textContent = `質問 ${Math.min(engine.askedCount + 1, engine.limit)} / ${engine.limit}`;
  const pct = (engine.askedCount / engine.limit) * 100;
  $("progress-bar").style.width = `${pct}%`;
  $("progress-bar").parentElement.setAttribute("aria-valuenow", String(Math.round(pct)));
  $("hunch-bar").style.height = `${Math.round(engine.hunch() * 100)}%`;
  $("btn-finish").hidden = engine.askedCount < 3;
}

// 進み具合のお知らせ（折り返し・ラスト1問）
// 「もっと質問に答える」の延長ラウンドでも、そのラウンドの中で数える
let roundStart = 0;
function progressNote() {
  const n = engine.askedCount + 1 - roundStart;
  const len = engine.limit - roundStart;
  if (n === len && len > 1) return line("last");
  if (n === Math.floor(len / 2) + 1 && len >= 6) return line("half_way");
  return "";
}

function renderStep(aside, mood = "idle") {
  step = engine.nextStep();
  if (!step) return renderResult();
  updateMeters();
  const note = progressNote();

  if (step.mode === "guess") {
    setMood(mascotQ(), "smug");
    setCard({ mode: "guess", aside: line("guess"), text: guessText(step.item.guess), note });
  } else {
    setMood(mascotQ(), mood);
    setCard({ aside: aside ?? "", text: step.item.question, note });
  }
  setButtons(step.mode);
  setBusy(false);
  show("question");
}

async function think() {
  setBusy(true);
  setMood(mascotQ(), "think");
  setCard({ mode: "thinking", aside: "", text: `${line("think")}…` });
  await wait(THINK_MS);
}

// 通常の質問で、同じ向き（信じている／見抜いている）の回答が何問続いているか
function beliefStreak() {
  const byId = Object.fromEntries(data.items.map((it) => [it.id, it]));
  const qs = engine.answers.filter((a) => a.mode !== "guess");
  const sign = (a) => Math.sign(beliefScore(byId[a.id], a.key));
  const last = qs.length ? sign(qs[qs.length - 1]) : 0;
  let n = 0;
  for (let i = qs.length - 1; i >= 0 && last !== 0 && sign(qs[i]) === last; i--) n++;
  return { sign: last, n };
}

// 回答へのリアクション：連続 → ピン度 → 答えの強さ の順に選ぶ
function reactionFor(v) {
  const soft = Math.abs(v) === 0.5;
  const streak = beliefStreak();
  if (streak.n >= 3 && streak.n % 3 === 0) {
    return streak.sign > 0 ? { kind: "streakLean", mood: "hunch" } : { kind: "streakClear", mood: "surprised" };
  }
  if (v > 0) return engine.hunch() >= 0.6 ? { kind: "hunch", mood: "hunch" } : { kind: soft ? "leanSoft" : "lean", mood: "idle" };
  if (v < 0) return { kind: soft ? "clearSoft" : "clear", mood: soft ? "think" : "surprised" };
  return { kind: "unsure", mood: "idle" };
}

async function onAnswer(key) {
  if (busy || !step) return;
  const v = beliefScore(step.item, key);
  engine.answer(step.item.id, key);
  const { kind, mood } = reactionFor(v);
  await think();
  renderStep(line(kind), mood);
}

async function onGuess(belief) {
  if (busy || !step) return;
  engine.answerGuess(step.item.id, belief);
  setBusy(true);
  if (belief >= 0.5) {
    guessRun = { hit: guessRun.hit + 1, miss: 0 };
    setMood(mascotQ(), "happy");
    const aside = guessRun.hit >= 2 ? line("hitStreak", { n: guessRun.hit }) : line(belief === 1 ? "hit" : "half");
    setCard({ mode: "hit", aside, text: belief === 1 ? "予想的中！" : "ちょっと当たり！" });
  } else if (belief < 0) {
    guessRun = { hit: 0, miss: guessRun.miss + 1 };
    setMood(mascotQ(), "surprised");
    const aside = guessRun.miss >= 2 ? line("missStreak", { n: guessRun.miss }) : line("miss");
    setCard({ mode: "miss", aside, text: "ハズレ…！" });
  } else {
    setMood(mascotQ(), "think");
    setCard({ mode: "thinking", aside: line("dodge"), text: "むむむ" });
  }
  updateMeters();
  await wait(REACT_MS);
  renderStep(line("afterGuess"), "idle");
}

function onBack() {
  if (busy) return;
  if (engine.undo()) renderStep(line("back"));
}

// ---------- 結果カード ----------

const answerLabel = (key) => ANSWERS.find((a) => a.key === key)?.label ?? "";

function linkList(links) {
  return el("ul", { class: "links" },
    links.map((l) => el("li", {}, el("a", { href: l.url, target: "_blank", rel: "noopener" }, l.label))));
}

function biasBox(b, { showName = true } = {}) {
  return el("div", { class: "bias" },
    showName && el("div", { class: "bias-name" }, b.name),
    el("div", { class: "bias-catch" }, `「${b.catch}」`),
    el("p", {}, b.explain),
    b.link && el("a", { class: "bias-link", href: b.link.url, target: "_blank", rel: "noopener" }, `${b.link.label} ↗`));
}

function stepSection(no, cls, title, ...body) {
  return el("section", { class: `step ${cls}` },
    el("h4", {}, el("span", { class: "step-no" }, String(no)), title),
    ...body);
}

// 疑似科学：そう感じる理由（寄り添い＋関係するバイアス）→ 実際の知見 → リンク
function pseudoscienceSteps(explain) {
  return [
    stepSection(1, "step-why", "そう感じるのは自然なこと",
      el("p", {}, explain.empathy),
      el("ul", { class: "bias-list" }, explain.biases.map((b) => el("li", {}, biasBox(b))))),
    stepSection(2, "step-facts", "実際にわかっていること",
      el("ul", { class: "facts" }, explain.facts.map((f) => el("li", {}, f)))),
    stepSection(3, "step-links", "もっと知りたい人へ", linkList(explain.links)),
  ];
}

// 心のクセ：まずクセそのものの説明 → 自然な理由 → 付き合い方 → リンク
function biasSteps(item, explain) {
  const [main] = explain.biases;
  return [
    main && stepSection(1, "step-what", "この心のクセとは",
      biasBox(main, { showName: main.name !== item.title })),
    stepSection(2, "step-why", "そう感じるのは自然なこと", el("p", {}, explain.empathy)),
    stepSection(3, "step-facts", "知っておくと役立つこと",
      el("ul", { class: "facts" }, explain.facts.map((f) => el("li", {}, f)))),
    stepSection(4, "step-links", "もっと知りたい人へ", linkList(explain.links)),
  ];
}

function resultCard({ item, key, mode, explain }, open) {
  const isBias = item.type === "bias";
  return el("details", { class: `card type-${item.type}`, ...(open ? { open: "" } : {}) },
    el("summary", {},
      el("span", { class: "badge" }, isBias ? "心のクセ" : "よくある思い込み"),
      el("span", { class: "card-title" }, item.title),
      el("span", { class: "your-answer" },
        mode === "guess" ? "ホントカナの予想が的中" : `あなたの答え：${answerLabel(key)}`)),
    el("p", { class: "q-recall" }, `Q. ${item.question}`),
    isBias ? biasSteps(item, explain) : pseudoscienceSteps(explain));
}

// ---------- 結果 ----------

function renderZukan(foundIds) {
  const before = loadZukan();
  const after = new Set([...before, ...foundIds]);
  saveZukan(after);
  const all = Object.entries(data.biases);
  $("zukan-count").textContent = `${after.size} / ${all.length}`;
  $("zukan-grid").replaceChildren(...all.map(([id, b]) => {
    if (!after.has(id)) return el("li", { class: "zk locked" }, el("div", { class: "zk-name" }, "？？？"));
    return el("li", { class: "zk" },
      !before.has(id) && el("span", { class: "zk-new" }, "NEW"),
      el("div", { class: "zk-name" }, b.name),
      el("div", { class: "zk-catch" }, b.catch));
  }));
}

// ---------- シェア ----------
// 送るのは結果の要約とページのURLだけ。個々の回答内容は含めない。

const pageUrl = () => location.origin + location.pathname;

function shareText({ matched, topBias, guesses }) {
  const parts = [
    matched.length
      ? `ホントカナに「思い込みかも」を${matched.length}つ見つけられた！`
      : "ホントカナに思い込みを1つも当てさせなかった！",
  ];
  if (topBias) parts.push(`心のクセNo.1は「${topBias.name}」`);
  if (guesses.total) parts.push(`予想は${guesses.total}回中${guesses.hits}回的中`);
  return `${parts.join("\n")}\n#ほんとかな診断`;
}

function renderShare(r) {
  const text = shareText(r);
  const url = pageUrl();
  $("share-preview").textContent = text;
  $("share-x").href = `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
  $("share-line").href = `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
  $("share-copy").onclick = async () => {
    try {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      $("share-copy").textContent = "コピーしました！";
    } catch {
      $("share-copy").textContent = "コピーできませんでした";
    }
    setTimeout(() => { $("share-copy").textContent = "テキストをコピー"; }, 1800);
  };
  $("share-native").hidden = !navigator.share;
  $("share-native").onclick = () => navigator.share({ title: document.title, text, url }).catch(() => {});
}

async function countUp(node, to) {
  node.textContent = "0";
  if (reducedMotion || to === 0) { node.textContent = String(to); return; }
  for (let i = 1; i <= to; i++) {
    await wait(Math.max(90, 420 / to));
    node.textContent = String(i);
  }
}

function renderResult() {
  const r = engine.result();
  const { matched, unsure, clear, straightLine, topBias, guesses } = r;

  const res = $("screen-result");
  res.classList.remove("revealed");
  setMood($("mascot-result"), "think");

  $("result-lead").textContent = matched.length
    ? "どれも多くの人が自然に持っているものです。責めるためではなく、次に情報に出会ったときの「ほんとかな？」のために読んでみてください。"
    : "今回は見つかりませんでした。しっかり見抜けています！ 質問を増やすと、別の項目も見られます。";

  $("straight-notice").hidden = !straightLine;
  if (straightLine) $("straight-title").textContent = `ほとんど「${answerLabel(straightLine)}」で答えていたようです`;

  $("top-bias").hidden = !topBias;
  if (topBias) {
    $("top-bias-name").textContent = topBias.name;
    $("top-bias-catch").textContent = `「${topBias.catch}」`;
  }
  $("guess-stat").hidden = guesses.total === 0;
  if (guesses.total) {
    $("guess-value").textContent = `${guesses.total}回中 ${guesses.hits}回 的中`;
    $("guess-sub").textContent = guesses.hits * 2 > guesses.total
      ? "今回はホントカナの勝ち！"
      : guesses.hits * 2 === guesses.total ? "今回は引き分け！" : "今回はあなたの勝ち！ 見抜き上手です";
  }

  $("matched-title").hidden = matched.length === 0;
  $("result-list").replaceChildren(...matched.map((m, i) => resultCard(m, i === 0)));

  $("unsure-wrap").hidden = unsure.length === 0;
  $("unsure-list").replaceChildren(...unsure.map((m) => resultCard(m, false)));

  $("clear-wrap").hidden = clear.length === 0;
  $("clear-list").replaceChildren(...clear.map((m) => el("li", {}, m.item.title)));

  renderZukan(r.foundBiasIds);
  renderShare(r);
  $("btn-more").hidden = !engine.hasMore();
  show("result");

  $("result-speech").textContent = line(matched.length === 0 ? "resultNone" : matched.length <= 2 ? "resultFew" : "resultMany");

  // 結果発表の演出：考え中 → カウントアップ → 表情 → 詳細を表示
  (async () => {
    await wait(700);
    await countUp($("reveal-num"), matched.length);
    setMood($("mascot-result"), matched.length ? "happy" : "surprised");
    await wait(350);
    res.classList.add("revealed");
  })();
}

// ---------- 起動 ----------

function renderStart() {
  const found = loadZukan().size;
  const total = Object.keys(data.biases).length;
  $("collection-teaser").hidden = found === 0;
  $("collection-teaser").textContent = `心のクセ図鑑：${found} / ${total} 種類 発見済み`;
  // セリフは固定文（<b>/<br>のみ）＋数値なので innerHTML で問題ない
  const kind = found === 0 ? "greetFirst" : found >= total ? "greetComplete" : "greetBack";
  $("greeting").innerHTML = line(kind, { found, total, left: total - found });
  setMood($("mascot-start"), "idle");
  show("start");
}

// キャラクターをタップすると、ひとこと＋ちょっと喜ぶ
function onMascotTap(host, target) {
  if (busy) return;
  const prev = host._prevMood ?? host.dataset.mood;
  host._prevMood = prev;
  setMood(host, "happy");
  const text = line("tap", { total: Object.keys(data.biases).length });
  if (host._old === undefined) host._old = target.innerHTML;
  target.textContent = text;
  clearTimeout(host._t);
  host._t = setTimeout(() => {
    setMood(host, prev);
    if (target.textContent === text) target.innerHTML = host._old;
    host._prevMood = host._old = undefined;
  }, 1800);
}

async function start() {
  engine = createEngine(data);
  guessRun = { hit: 0, miss: 0 };
  roundStart = 0;
  await think();
  renderStep(line("first"));
}

async function init() {
  try {
    const res = await fetch(DATA_URL, { cache: "no-cache" });
    if (!res.ok) throw new Error(res.status);
    data = await res.json();
  } catch (e) {
    console.error(e);
    return show("error");
  }

  mountMascot($("mascot-start"), "idle");
  mountMascot($("mascot-q"), "idle");
  mountMascot($("mascot-result"), "think");

  $("mascot-start").addEventListener("click", () => onMascotTap($("mascot-start"), $("greeting")));
  mascotQ().addEventListener("click", () => onMascotTap(mascotQ(), $("q-aside")));
  $("mascot-result").addEventListener("click", () => onMascotTap($("mascot-result"), $("result-speech")));

  $("btn-start").addEventListener("click", () => { show("question"); start(); });
  $("btn-back").addEventListener("click", onBack);
  $("btn-finish").addEventListener("click", () => { if (!busy && engine) renderResult(); });
  $("btn-restart").addEventListener("click", renderStart);
  $("btn-more").addEventListener("click", () => { roundStart = engine.askedCount; engine.extend(); renderStep(line("more")); });

  // キーボード：数字キーで回答、Backspaceで戻る
  document.addEventListener("keydown", (e) => {
    if ($("screen-question").hidden || busy || !step || e.metaKey || e.ctrlKey || e.altKey) return;
    const i = Number(e.key) - 1;
    if (step.mode === "guess" && i >= 0 && i < GUESS_ANSWERS.length) onGuess(GUESS_ANSWERS[i].belief);
    else if (step.mode === "question" && i >= 0 && i < ANSWERS.length) onAnswer(ANSWERS[i].key);
    else if (e.key === "Backspace") onBack();
  });

  renderStart();
}

init();
