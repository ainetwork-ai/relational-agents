/**
 * Korean content used by components and app routes that is DATA by nature —
 * specimen text, keyword lists that match Korean titles, demo names — not UI
 * text to be translated. Code outside src/i18n imports it from here so no
 * Korean literal lives in the code itself.
 */

/** Hangul pangram shown in the font preview specimen. */
export const HANGUL_PANGRAM = "다람쥐 헌 쳇바퀴에 타고파";
/** A run of Hangul syllables for the font preview's character set. */
export const HANGUL_SYLLABLES = "가나다라마바사아자차카타파하";

/** Title prefixes of file-primary relationship docs (OKF root folders), Korean
 *  and English, current and older naming: "Family doc — A · B". */
export const RELATIONSHIP_DOC_PREFIXES = ["relationship doc", "관계 문서", "family doc", "가족 문서"] as const;

/** The IME double-send bug as logged (hooks/use-ime-guard.ts): typing this
 *  word and pressing Enter once posted the whole text, then just the last
 *  syllable. `logged` is what the two sends carried; `committing` is the
 *  syllable the IME was asking to commit. */
export const IME_DOUBLE_SEND_EXAMPLE = {
  typed: "댓글",
  logged: ["댓끌", "끌"],
  committing: "글",
} as const;
