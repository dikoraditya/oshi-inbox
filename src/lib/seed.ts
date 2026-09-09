import {
  PLACEHOLDER_IMAGE,
  type Gloss,
  type Group,
  type Member,
  type Message,
  type Source,
} from "./types";

/**
 * Seed content, transcribed verbatim from the design canvas.
 *
 * This is written into IndexedDB once, on first run. After that the database is
 * the source of truth and this file is never consulted again — editing a seed
 * message here will not change an already-populated install.
 */

/**
 * `emailAddresses` starts empty for everyone. It fills in as you assign
 * ingested mail — the app learns which sender is which member rather than
 * shipping guesses about anyone's real address.
 */
export const MEMBERS: Member[] = [
  { id: "konoa", name: "Amano Konoa", group: "AKB48", source: "755 Talk", unread: 12, time: "08:35", emailAddresses: [], attributionKeys: [] },
  { id: "momoka", name: "Ito Momoka", group: "AKB48", source: "Weverse DM", unread: 97, time: "Aug 24", emailAddresses: [], attributionKeys: [] },
  { id: "yamauchi", name: "Mizuki Yamauchi", group: "AKB48", source: "Weverse DM", unread: 37, time: "Aug 24", emailAddresses: [], attributionKeys: [] },
  { id: "yuyu", name: "Ichihara Ayumi", group: "AKB48", source: "Mobile Mail", unread: 2, time: "10:44", emailAddresses: [], attributionKeys: [] },
  { id: "mai", name: "Takahashi Mai", group: "Nogizaka46", source: "Mobile Mail", unread: 4, time: "12:02", emailAddresses: [], attributionKeys: [] },
  { id: "shuri", name: "Aida Shuri", group: "Nogizaka46", source: "755 Talk", unread: 21, time: "21:15", emailAddresses: [], attributionKeys: [] },
  { id: "moeka", name: "Yada Moeka", group: "niajoy", source: "niajoy Talk", unread: 36, time: "19:59", emailAddresses: [], attributionKeys: [] },
  { id: "urumi", name: "Urumi Morihira", group: "niajoy", source: "niajoy Talk", unread: 8, time: "19:01", emailAddresses: [], attributionKeys: [] },
  { id: "kokone", name: "Kokone Atago", group: "niajoy", source: "niajoy Talk", unread: 0, time: "Aug 23", emailAddresses: [], attributionKeys: [] },
];

/** The canvas tuple shape: [jp, romaji, en, words, opts]. */
type SeedTuple = [
  string,
  string,
  string,
  Array<[string, string, string]>,
  { time: string; image?: boolean; long?: boolean },
];

const SEED_THREADS: Record<string, SeedTuple[]> = {
  konoa: [
    [
      "秋の服ってすごく可愛いよね？！インスタ大好きだから、もっと頑張って投稿したいな！",
      "Aki no fuku tte sugoku kawaii yo ne?! Insuta daisuki dakara, motto ganbatte tōkō shitai na!",
      "Autumn clothes are so cute, aren't they?! I love Instagram, so I want to put more effort into posting!",
      [["秋", "aki", "autumn"], ["可愛い", "kawaii", "cute"], ["投稿", "tōkō", "a post; to post"]],
      { time: "21:35" },
    ],
    [
      "これはアプリでしか見られません。",
      "Kore wa apuri de shika miraremasen.",
      "This can only be viewed in the app.",
      [["アプリ", "apuri", "app"]],
      { time: "22:02", image: true },
    ],
    [
      "おはよう！みんないつもメッセージありがとう、ちゃんと見てるよ。",
      "Ohayō! Minna itsumo messēji arigatō, chanto miteru yo.",
      "Good morning! Thank you all for always sending messages — I really do read them.",
      [["おはよう", "ohayō", "good morning (casual)"], ["いつも", "itsumo", "always"], ["見てる", "miteru", "am watching / reading"]],
      { time: "08:35" },
    ],
  ],
  momoka: [
    [
      "久しぶりの公演たのしいね",
      "Hisashiburi no kōen tanoshii ne",
      "The first show in a while — it's fun, isn't it",
      [["久しぶり", "hisashiburi", "after a long time"], ["公演", "kōen", "performance, show"], ["たのしい", "tanoshii", "fun, enjoyable"]],
      { time: "20:12" },
    ],
    [
      "おやさみ",
      "Oyasami",
      "G'night (her softened spelling of oyasumi)",
      [["おやさみ", "oyasami", "good night — playful oyasumi"]],
      { time: "23:40" },
    ],
  ],
  yamauchi: [
    [
      "リハはじまるっ🍙",
      "Riha hajimaru' 🍙",
      "Rehearsal's starting 🍙",
      [["リハ", "riha", "rehearsal (clipped rihāsaru)"], ["はじまる", "hajimaru", "to begin"]],
      { time: "13:05" },
    ],
  ],
  yuyu: [
    [
      "おはゆうございます！！昨日はメールを送れなくってごめんなさい。21期研究生5人で、秋田でたくさんプロモーションを頑張ってきました〜一日中たっくさんラジオや撮影などなど、、、すっごく充実した一日でした。まだ不慣れなところもあって、もっともっと上手になりたいなと感じた1日でした。一つ一つこなすのに精一杯で写真フォルダ見返してみたら、全然写真ないよーーー笑",
      "Ohayū gozaimasu!! Kinō wa mēru o okurenakutte gomen nasai. Nijūichi-ki kenkyūsei gonin de, Akita de takusan puromōshon o ganbatte kimashita～ Ichinichi-jū takkusan rajio ya satsuei nado nado,,, Suggoku jūjitsu shita ichinichi deshita. Mada funare na tokoro mo atte, motto motto jōzu ni naritai na to kanjita ichinichi deshita. Hitotsu hitotsu konasu no ni seiippai de shashin foruda mikaeshite mitara, zenzen shashin nai yo—— (laughs)",
      "Good moryuning!! Sorry I couldn't send a mail yesterday. The five of us from the 21st-generation trainees went to Akita and worked hard on lots of promotion～ All day long, radio and photo shoots and more and more,,, It was a really full day. There are still things I'm not used to, and it was a day that made me want to get much, much better. I was so busy getting through them one by one that when I looked back through my photo folder, there were no photos at all lol",
      [["研究生", "kenkyūsei", "trainee"], ["撮影", "satsuei", "filming, photo shoot"], ["充実", "jūjitsu", "fulfilling, full"], ["不慣れ", "funare", "unaccustomed, inexperienced"], ["精一杯", "seiippai", "with all one's might"]],
      { time: "10:44", image: true, long: true },
    ],
  ],
  mai: [
    [
      "会いたいなあ🙂",
      "Aitai nā 🙂",
      "I miss you 🙂",
      [["会いたい", "aitai", "want to see you; miss you"]],
      { time: "12:02" },
    ],
  ],
  shuri: [
    [
      "見えました！みんな教えてくれてありがとう！わー、みんなに手紙を送らせちゃった！",
      "Miemashita! Minna oshiete kurete arigatō! Wā, minna ni tegami o okurasechatta!",
      "I could see it! Thank you everyone for letting me know! Oh no, I made everyone send me letters!",
      [["見える", "mieru", "to be visible"], ["教える", "oshieru", "to tell, to teach"], ["手紙", "tegami", "letter"]],
      { time: "21:14" },
    ],
    [
      "見てくれてるだけで本当に嬉しいです！",
      "Mite kureteru dake de hontō ni ureshii desu!",
      "Just knowing you're watching makes me really happy!",
      [["本当に", "hontō ni", "really"], ["嬉しい", "ureshii", "happy, glad"]],
      { time: "21:15" },
    ],
  ],
  moeka: [
    [
      "また元カレしたいー",
      "Mata Motokare shitai—",
      'I want to perform "Motokare" again—',
      [["また", "mata", "again"], ["元カレ", "motokare", "ex-boyfriend — here a song title"]],
      { time: "19:59" },
    ],
    [
      "きみたち早く寝なっ♡おやすみ",
      "Kimitachi hayaku nena' ♡ oyasumi",
      "All of you, get to sleep early ♡ good night",
      [["きみたち", "kimitachi", "you all"], ["早く", "hayaku", "early, quickly"], ["寝な", "nena", "go to sleep (soft command)"]],
      { time: "23:12" },
    ],
  ],
  urumi: [
    [
      "dikoおつかれさま‼今日も収録だよ〜楽屋にあったら嬉しいお菓子はしあわせバタ〜です🍊",
      "diko otsukaresama!! Kyō mo shūroku da yo～ Gakuya ni attara ureshii okashi wa Shiawase Batā～ desu 🍊",
      "Good work today, diko!! Another recording today～ The snack I'd be happy to find in the dressing room is Shiawase Butter 🍊",
      [["おつかれさま", "otsukaresama", "thanks for your hard work"], ["収録", "shūroku", "studio recording"], ["楽屋", "gakuya", "dressing room"], ["お菓子", "okashi", "snacks, sweets"]],
      { time: "19:01", image: true },
    ],
  ],
  kokone: [
    [
      "今日もありがとうございました！",
      "Kyō mo arigatō gozaimashita!",
      "Thank you for today as well!",
      [["今日", "kyō", "today"]],
      { time: "Aug 23" },
    ],
  ],
};

function toGlosses(raw: Array<[string, string, string]>): Gloss[] {
  return raw.map(([jp, romaji, gloss]) => ({ jp, romaji, gloss }));
}

/**
 * Flatten the seed tuples into Message records.
 *
 * `createdAt` is a synthetic counter rather than a real clock: the design's
 * timestamps are display strings ("Aug 24", "21:35") with no date behind them,
 * so thread order comes from the authored order, not from parsing those.
 */
export function buildSeedMessages(): Message[] {
  const out: Message[] = [];
  let seq = 0;

  for (const member of MEMBERS) {
    const tuples = SEED_THREADS[member.id] ?? [];
    for (const [jp, romaji, en, words, opts] of tuples) {
      out.push({
        id: `seed-${member.id}-${seq}`,
        memberId: member.id,
        jp,
        romaji,
        en,
        words: toGlosses(words),
        time: opts.time,
        source: member.source as Source,
        // Seed screenshots are placeholders — the design shipped no real images.
        imageUrl: opts.image ? PLACEHOLDER_IMAGE : null,
        long: !!opts.long,
        status: "done",
        createdAt: seq,
      });
      seq += 1;
    }
  }

  return out;
}

export const GROUP_OF: Record<string, Group> = Object.fromEntries(
  MEMBERS.map((m) => [m.id, m.group]),
);
