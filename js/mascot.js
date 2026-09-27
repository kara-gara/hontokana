// 案内役キャラクター「ホントカナ」。表情（mood）とセリフだけを扱う。
// mood: idle | think | hunch | smug | happy | surprised

const SVG = `
<svg class="mascot-svg" viewBox="0 0 120 130" aria-hidden="true">
  <path class="m-curl" d="M50 26 C46 8 74 2 77 16 C79 25 66 26 66 20" />
  <circle class="m-dot" cx="81" cy="8" r="4.5" />
  <path class="m-body" d="M60 22 C93 22 110 44 110 72 C110 102 89 120 60 120 C45 120 36 116 26 124 C29 112 17 102 13 86 C8 58 26 22 60 22 Z" />
  <ellipse class="m-cheek" cx="30" cy="84" rx="8" ry="5" />
  <ellipse class="m-cheek" cx="90" cy="84" rx="8" ry="5" />
  <g class="m-eyes">
    <ellipse class="m-white" cx="44" cy="66" rx="11" ry="12.5" />
    <ellipse class="m-white" cx="76" cy="66" rx="11" ry="12.5" />
    <g class="m-pupils">
      <circle cx="45" cy="68" r="5.5" /><circle cx="77" cy="68" r="5.5" />
    </g>
    <path class="m-lid" d="M32 60 Q44 52 56 60 L56 52 L32 52 Z M64 60 Q76 52 88 60 L88 52 L64 52 Z" />
  </g>
  <path class="m-mouth mouth-idle" d="M52 90 Q60 97 68 90" />
  <path class="m-mouth mouth-think" d="M52 93 Q56 90 60 93 T68 93" />
  <path class="m-mouth mouth-smug" d="M50 89 Q62 99 72 86" />
  <path class="m-mouth mouth-happy filled" d="M49 88 Q60 104 71 88 Z" />
  <ellipse class="m-mouth mouth-surprised filled" cx="60" cy="93" rx="5" ry="6.5" />
  <g class="m-sweat"><path d="M100 46 Q104 54 100 58 Q96 54 100 46 Z" /></g>
  <g class="m-spark"><path d="M104 20 l3 7 7 3 -7 3 -3 7 -3 -7 -7 -3 7 -3 z" /></g>
</svg>`;

export function mountMascot(host, mood = "idle") {
  host.innerHTML = SVG;
  host.classList.add("mascot");
  setMood(host, mood);
}

export function setMood(host, mood) {
  host.dataset.mood = mood;
}

// 同じセリフが続かないよう、種類ごとに直前のものを避けて選ぶ
const lastPicked = {};
function pick(kind, arr) {
  const pool = arr.length > 1 ? arr.filter((x) => x !== lastPicked[kind]) : arr;
  const v = pool[Math.floor(Math.random() * pool.length)];
  lastPicked[kind] = v;
  return v;
}

// セリフ集。からかわず、あくまで楽しげに。{n} などは line() の vars で置き換える
export const LINES = {
  first: ["では、はじめましょう。直感でどうぞ！", "さっそくいきますよ〜", "肩の力を抜いて、思ったままでOKです", "準備はいいですか？ 1問目！"],
  lean: ["ふむふむ…", "なるほど、なるほど", "メモしておきますね", "ほほう…", "うんうん、わかります", "そう感じる人、多いんですよ", "なるほど〜、そう来ましたか"],
  leanSoft: ["「たぶん」ですね。メモメモ", "ちょっと迷いつつ…ですね", "その“たぶん”、大事にしますよ", "ふむ、半分くらいそう、と"],
  hunch: ["おや？ 何か見えてきたぞ…", "ピンと来はじめました…", "だんだんわかってきましたよ", "むむっ、頭の上で何か光った…", "推理がつながってきた…！"],
  clear: ["ほうほう、そう来ましたか", "なかなか鋭いですね", "ふむ、そっちか…", "おっと、手強い！", "さすが、よく見てますね", "読みが外れた…やりますね"],
  clearSoft: ["「たぶん違う」ですね、了解です", "慎重派ですね", "ふむ、ちょっと疑ってる感じ…"],
  unsure: ["迷うところですよね", "OK、次いきましょう", "わからないも立派な答えです", "正直でよろしい！", "たしかに、判断が難しいですよね"],
  streakLean: ["今日は素直モードですね〜", "連続で「そう思う」！ 推理がはかどります", "いい流れです…ふっふっふ"],
  streakClear: ["連続で見抜かれてる…！", "むむ、あなた手強いですね", "ホントカナ、ちょっと焦ってきました"],
  guess: ["ピンときた！", "ひらめいた！", "わかっちゃったかも…！", "ズバリ言いますよ…！", "ホントカナの推理によると…", "来た来た来た…！"],
  hit: ["やっぱり！ ホントカナの目はごまかせません", "当たった〜！ でも、みんなそう思いがちなんです", "ビンゴ！ 結果でくわしくお話ししますね", "よしっ！ 推理が冴えてます", "的中！ …あ、責めてるわけじゃないですよ"],
  hitStreak: ["連続的中！ 今日のホントカナは絶好調", "また当たった！ 自分でもびっくりです", "{n}連続的中…！ 名探偵を名乗ってもいいですか？"],
  half: ["おしい！ ちょっとだけ当たり、ですね", "半分当たり！ いい線いってました", "ちょっと当たり…じわじわ嬉しい"],
  miss: ["むむっ、外れた…！ あなた、なかなか手強い", "おっと、読み違えました。やりますね", "ハズレかぁ〜。次こそは…！", "しまった、深読みしすぎました", "くっ…見抜き上手ですね"],
  missStreak: ["{n}連続ハズレ…自信なくしそう…", "今日のあなた、読めない…！", "ホントカナ、修行が足りませんでした"],
  dodge: ["はぐらかされた…？", "むむむ、ポーカーフェイス…", "わからない、か…謎が深まる"],
  think: ["考え中", "推理中", "うーん", "ひらめき待ち", "頭をひねり中"],
  afterGuess: ["では次の質問です", "気を取り直して…", "推理を続けます！", "さあ、次いきましょう"],
  back: ["ひとつ戻りますね", "はい、やり直しどうぞ", "考え直しもアリです"],
  more: ["まだまだいきますよ！", "延長戦、スタートです", "もっと当てちゃいますよ〜"],
  half_way: ["折り返し地点です！", "半分きました！"],
  last: ["ラストの質問です！", "いよいよ最後の1問！"],
  tap: ["つついても何も出ませんよ〜", "くすぐったい！", "ホントカナは「ほんとかな？」から生まれました", "心のクセは全部で{total}種類。集めてみてね", "疑うのは、相手じゃなくて情報のほう、ですよ", "こう見えて推理は得意なんです", "質問はじっくり読んでくださいね"],
  greetFirst: ["こんにちは、<b>ホントカナ</b>です。<br>あなたが心のどこかで信じていること、<br>当ててみせましょう。"],
  greetBack: ["おかえりなさい！<br>心のクセ図鑑はいま <b>{found} / {total}</b>。<br>今日は何が見つかるかな？", "また来てくれたんですね！<br>図鑑コンプリートまで、あと <b>{left}</b> 種類です。", "待ってました！<br>前回とは違う質問も出ますよ。"],
  greetComplete: ["図鑑コンプリート、おめでとうございます！<br>もう心のクセ博士ですね。<br>それでも、もう一勝負いかがですか？"],
  resultNone: ["今回は完敗です…しっかり見抜かれました！", "むむ、ひとつも当たらず…あなた、見抜き上手ですね"],
  resultFew: ["少しだけ見つかりました。誰にでもあるものですよ", "ちらっと見えました。気づけたら、もう一歩先に進めます"],
  resultMany: ["いくつか見つかりました！ でも、ほとんどの人が同じくらい持っています", "たくさん見つけちゃいました。気づけたのは大きな一歩です！"],
};

export function line(kind, vars = {}) {
  const text = pick(kind, LINES[kind]);
  return text.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
}

// 予想の言い回し
const GUESS_TEMPLATES = [
  (g) => `あなた、『${g}』って思っていませんか？`,
  (g) => `ズバリ！ 『${g}』…ですよね？`,
  (g) => `もしかして、『${g}』と思ってたりします？`,
  (g) => `ホントカナの読みでは……『${g}』派とみた！`,
  (g) => `当ててみせます。『${g}』、心当たりありません？`,
];
export const guessText = (g) => pick("guessTpl", GUESS_TEMPLATES)(g);
