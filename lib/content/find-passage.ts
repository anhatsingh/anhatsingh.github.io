/*
  Finding the sentence an answer came from.

  The assistant quotes what it used and the page locates it. Quoting is the
  thing a model is naturally good at; reproducing punctuation exactly is the
  thing it is bad at, so this is deliberately forgiving — and, more importantly,
  it fails cleanly. A miss falls back to the whole-entry highlight that already
  happens today, which is what makes it safe to attempt at all.

  It also has to bridge a gap. What the model quotes from is not the page: the
  indexer flattens blocks with blocksToPlainText, which strips inline markdown,
  so a chunk says "Java" where the source says "**Java**". Normalising the same
  way on both sides lines them up rather than pulling them apart.

  Pure, and in a plain module rather than a client one — the body is
  server-rendered, and verify-boundaries.ts forbids a server file importing
  values across a "use client" boundary.
*/

/** Where a passage sits in the normalised text. */
export interface PassageMatch {
  start: number;
  end: number;
  /** True when only part of the quote was found — a model that trailed off. */
  partial: boolean;
}

/*
  Below this a "distinctive run" stops being distinctive. Eight characters
  matches "the data" somewhere in almost any article, and a highlighter landing
  on the wrong sentence is worse than one that doesn't appear.
*/
const MIN_RUN = 24;

/**
 * Folds away everything two copies of the same sentence can differ by.
 *
 * Returns the normalised text AND a map from each normalised character back to
 * its index in the original, because the caller needs to highlight the
 * original — a match at normalised offset 40 is useless without knowing where
 * that is in the text the reader can see.
 */
export function normalise(input: string): { text: string; map: number[] } {
  const out: string[] = [];
  const map: number[] = [];
  let lastWasSpace = true; // leading space is collapsed away entirely

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    /*
      Markdown punctuation, dropped. The indexed copy has already lost it and
      the rendered copy never had it, so keeping it here would mean only the
      raw source ever matched — the one form nobody is comparing against.
    */
    if (ch === "*" || ch === "_" || ch === "`" || ch === "#") continue;

    if (/\s/.test(ch)) {
      if (lastWasSpace) continue;
      out.push(" ");
      map.push(i);
      lastWasSpace = true;
      continue;
    }

    out.push(fold(ch));
    map.push(i);
    lastWasSpace = false;
  }

  // A trailing space would make an otherwise-exact match miss by one.
  while (out.length && out[out.length - 1] === " ") {
    out.pop();
    map.pop();
  }

  return { text: out.join(""), map };
}

/*
  Typographic variants of the same character.

  A model writes a straight apostrophe where the page has a curly one about as
  often as not, and neither is more correct — they are the same word.
*/
function fold(ch: string): string {
  switch (ch) {
    case "‘":
    case "’":
    case "ʼ":
      return "'";
    case "“":
    case "”":
      return '"';
    case "–":
    case "—":
    case "−":
      return "-";
    case "…":
      return ".";
    case " ":
      return " ";
    default:
      return ch.toLowerCase();
  }
}

/**
 * Locates a quote inside a body of text.
 *
 * Offsets are into `haystack` as given, not into the normalised form, so the
 * caller can map them onto real text nodes.
 */
export function findPassage(haystack: string, quote: string): PassageMatch | null {
  const needleText = normalise(quote).text;
  if (needleText.length < MIN_RUN) return null;

  const hay = normalise(haystack);

  const whole = hay.text.indexOf(needleText);
  if (whole !== -1) {
    return {
      start: hay.map[whole],
      // The map holds the index of each character's FIRST byte, so the end of
      // the match is one past the last character's own index.
      end: hay.map[whole + needleText.length - 1] + 1,
      partial: false,
    };
  }

  /*
    Nothing matched whole, so try the longest run of the quote that does.

    A model that paraphrases the tail — or quotes across a boundary the
    renderer joined differently — still lands on the right sentence. Longest
    first, from the start of the quote, because the opening is what it was
    actually looking at.
  */
  for (let length = needleText.length - 1; length >= MIN_RUN; length--) {
    const run = needleText.slice(0, length);
    const at = hay.text.indexOf(run);
    if (at === -1) continue;

    return {
      start: hay.map[at],
      end: hay.map[at + length - 1] + 1,
      partial: true,
    };
  }

  return null;
}
