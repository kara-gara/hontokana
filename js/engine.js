// 質問選択・判定のロジック（DOMに依存しない純粋な処理）。
//
// 拡張ポイント:
//   createEngine(data, { selector, explainer }) の selector / explainer を差し替えれば、
//   将来 LLM による質問生成や解説のパーソナライズを組み込める。
//   既定はルールベースで、外部通信は一切しない。

export const ANSWERS = [
  { key: "yes",      label: "はい",       value: 1 },
  { key: "prob_yes", label: "たぶんはい", value: 0.5 },
  { key: "unknown",  label: "わからない", value: 0 },
  { key: "prob_no",  label: "たぶんいいえ", value: -0.5 },
  { key: "no",       label: "いいえ",     value: -1 },
];

export const DEFAULT_CONFIG = {
  maxQuestions: 10,       // 1ラウンドで聞く数
  matchThreshold: 0.5,    // 「当てはまった」とみなす信念スコア（たぶんはい以上）
  relatedWeight: 1.0,     // 関連項目へのブースト
  sharedBiasWeight: 0.4,  // 共通のバイアスを持つ項目へのブースト（1バイアスあたり）
  sharedTagWeight: 0.15,  // 共通タグ1つあたりのブースト
  negativeDamping: 0.3,   // 「いいえ」寄りのときに関連項目を少し下げる係数
  jitter: 0.3,            // 出題順に少しランダム性を持たせる
  polarityRun: 3,         // 同じ向きの質問が続いてよい最大数
  guessThreshold: 1.2,    // 関連度（jitterを除く）がこれ以上なら、質問せずに「予想」を出す
  guessMinAsked: 2,       // 最初の数問は予想しない
  guessCooldown: 2,       // 予想のあと、最低この問数は通常の質問をはさむ
  straightLineMin: 5,     // この問数以上答えていて…
  straightLineRatio: 0.9, // …同じ答えがこの割合以上なら「同じ答えの連続」とみなす
};

const answerValue = (key) => ANSWERS.find((a) => a.key === key)?.value ?? 0;

// 回答値 × polarity = 信念スコア（+1 = その思い込みを強く持っている）
export function beliefScore(item, answerKey) {
  return answerValue(answerKey) * (item.polarity ?? 1);
}

// 既定の出題戦略：関連度スコア（priority）が最も高い未出題項目。
// ただし同じ向き（polarity）の質問が polarityRun 問続いたら、逆向きの質問を優先して挟む。
export function relevanceSelector({ items, priorities, askedIds, answers, config }) {
  const byId = Object.fromEntries(items.map((it) => [it.id, it]));
  const pol = (it) => it.polarity ?? 1;
  const recent = answers.slice(-config.polarityRun).map((a) => pol(byId[a.id]));
  const flip = recent.length === config.polarityRun && recent.every((p) => p === recent[0])
    && items.some((it) => !askedIds.has(it.id) && pol(it) !== recent[0]);

  let best = null;
  for (const item of items) {
    if (askedIds.has(item.id)) continue;
    if (flip && pol(item) === recent[0]) continue;
    if (!best || priorities[item.id] > priorities[best.id]) best = item;
  }
  return best;
}

// 既定の解説プロバイダ：JSONの内容をそのまま構造化して返す
export function staticExplainer({ item, biases }) {
  return {
    empathy: item.empathy,
    biases: (item.biases || []).map((id) => ({ id, ...biases[id] })).filter((b) => b.name),
    facts: item.facts || [],
    links: item.links || [],
  };
}

export function createEngine(data, options = {}) {
  const config = { ...DEFAULT_CONFIG, ...(options.config || {}) };
  const selector = options.selector || relevanceSelector;
  const explainer = options.explainer || staticExplainer;
  const random = options.random || Math.random;

  const items = data.items;
  const byId = Object.fromEntries(items.map((it) => [it.id, it]));

  // 初期の揺らぎは開始時に固定し、「戻る」で再計算しても順番が変わらないようにする
  const jitter = Object.fromEntries(items.map((it) => [it.id, random() * config.jitter]));

  let answers = []; // [{ id, key, mode: "question" | "guess" }]
  let limit = config.maxQuestions;

  function computePriorities() {
    const p = { ...jitter };
    for (const { id, key } of answers) {
      const src = byId[id];
      const v = beliefScore(src, key);
      if (v === 0) continue;
      const w = v > 0 ? v : v * config.negativeDamping;
      for (const target of items) {
        if (target.id === id) continue;
        let boost = 0;
        if ((src.related || []).includes(target.id)) boost += config.relatedWeight;
        const sharedBiases = (src.biases || []).filter((b) => (target.biases || []).includes(b)).length;
        boost += sharedBiases * config.sharedBiasWeight;
        const sharedTags = (src.tags || []).filter((t) => (target.tags || []).includes(t)).length;
        boost += sharedTags * config.sharedTagWeight;
        p[target.id] += w * boost;
      }
    }
    return p;
  }

  const askedIds = () => new Set(answers.map((a) => a.id));

  // 質問には「はい＝正しい理解」の逆転項目（polarity: -1）も混ぜてあるので、
  // 内容を読まずに同じボタンを押し続けると結果が矛盾する。その場合は回答キーを返す。
  function detectStraightLine() {
    const counts = {};
    // 予想への回答（当たり/ハズレ）は polarity で key が反転するので、通常の質問だけで判定する
    const qs = answers.filter((a) => a.mode !== "guess");
    if (qs.length < config.straightLineMin) return null;
    for (const { key } of qs) counts[key] = (counts[key] || 0) + 1;
    const [key, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return n / qs.length >= config.straightLineRatio ? key : null;
  }

  return {
    config,
    get answers() { return answers.slice(); },
    get askedCount() { return answers.length; },
    get total() { return items.length; },
    get limit() { return Math.min(limit, items.length); },

    isRoundOver() {
      return answers.length >= this.limit;
    },

    hasMore() {
      return answers.length < items.length;
    },

    // 次のラウンドへ（残りの質問にも答える）
    extend(n = config.maxQuestions) {
      limit = Math.min(answers.length + n, items.length);
    },

    next() {
      return this.nextStep()?.item ?? null;
    },

    // 次の一手：{ item, mode: "question" | "guess", confidence }
    // 関連項目への「はい」が重なって関連度が十分高まった項目は、質問ではなく「予想」として出す。
    nextStep() {
      if (this.isRoundOver()) return null;
      const priorities = computePriorities();
      const item = selector({ items, priorities, askedIds: askedIds(), answers, config });
      if (!item) return null;
      const confidence = priorities[item.id] - jitter[item.id];
      const lastGuess = answers.map((a) => a.mode).lastIndexOf("guess");
      const sinceGuess = lastGuess < 0 ? Infinity : answers.length - 1 - lastGuess;
      const canGuess = answers.length >= config.guessMinAsked && sinceGuess >= config.guessCooldown;
      const mode = canGuess && confidence >= config.guessThreshold ? "guess" : "question";
      return { item, mode, confidence };
    },

    answer(id, key, mode = "question") {
      answers.push({ id, key, mode });
    },

    // 予想への回答：belief（+1 当たり … -1 ハズレ）を polarity に合わせて回答キーに変換して記録
    answerGuess(id, belief) {
      const value = belief * (byId[id].polarity ?? 1);
      const key = ANSWERS.reduce((a, b) => (Math.abs(b.value - value) < Math.abs(a.value - value) ? b : a)).key;
      answers.push({ id, key, mode: "guess" });
    },

    // 現在の「ピンと来てる度」（0〜1）。キャラクターの表情などに使う
    hunch() {
      const p = computePriorities();
      const asked = askedIds();
      const max = Math.max(0, ...items.filter((it) => !asked.has(it.id)).map((it) => p[it.id] - jitter[it.id]));
      return Math.min(1, max / config.guessThreshold);
    },

    undo() {
      return answers.pop() || null;
    },

    // 結果：当てはまった / 迷った / 見抜けていた に分類し、解説を付ける
    result() {
      const scored = answers.map(({ id, key, mode }) => {
        const item = byId[id];
        return { item, key, mode, score: beliefScore(item, key) };
      });
      const matched = scored.filter((r) => r.score >= config.matchThreshold).sort((a, b) => b.score - a.score);

      // 当てはまった項目に関係するバイアスを信念スコアで重みづけして集計 → 心のクセ No.1
      const biasScore = {};
      for (const r of matched) for (const b of r.item.biases || []) biasScore[b] = (biasScore[b] || 0) + r.score;
      const topBiasId = Object.entries(biasScore).sort((a, b) => b[1] - a[1])[0]?.[0];

      const guesses = scored.filter((r) => r.mode === "guess");
      const withExplain = (r) => ({ ...r, explain: explainer({ item: r.item, biases: data.biases, answerKey: r.key }) });
      return {
        straightLine: detectStraightLine(),
        topBias: topBiasId ? { id: topBiasId, ...data.biases[topBiasId] } : null,
        foundBiasIds: Object.keys(biasScore),
        guesses: { total: guesses.length, hits: guesses.filter((r) => r.score >= config.matchThreshold).length },
        matched: matched.map(withExplain),
        unsure: scored.filter((r) => r.score === 0).map(withExplain),
        clear: scored.filter((r) => r.score < 0),
      };
    },
  };
}
