/**
 * 멘션(@) 사람 검색 — 원본에서 잰 규칙 그대로.
 * 측정: docs/notion-comment-mention.md §1·§2 (2026-09-10, 노션 댓글 입력줄에서 23개 질의).
 *
 * 요약:
 *  · 표시 이름과 **이메일**을 함께, 부분 문자열로, 대소문자 무시하고 찾는다.
 *  · 한글은 **초성**으로도 찾는다(`ㅎ` → 홍혜령).
 *  · 순서는 이름 맨 앞 > 단어 맨 앞 > 가운데. 같은 등급이면 나 먼저, 게스트 나중.
 *  · 5개까지 보이고 나머지는 `N개 결과 더 보기` 한 줄로 접힌다.
 *
 * 순수 함수만 둔다 — 서버(알림 대상 확인)와 클라이언트(메뉴)가 같은 답을 써야 하기 때문이다.
 */

export interface MentionPerson {
  id: string;
  displayName: string;
  email?: string | null;
  avatarUrl?: string | null;
  isAgent?: boolean;
  /** 워크스페이스 역할. "guest" 는 같은 등급에서 뒤로 밀린다(원본도 `게스트` 배지를 달고 아래에 둔다). */
  role?: string | null;
}

/** 원본이 한 섹션에 보여주는 사람 수. 넘치면 `N개 결과 더 보기`. */
export const PEOPLE_SHOWN = 5;

const LEAD = [
  "ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ",
  "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ",
];

/** 한글 음절을 초성으로, 나머지는 그대로. "홍혜령" → "ㅎㅎㄹ" */
export function leadJamo(s: string): string {
  let out = "";
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (code >= 0xac00 && code <= 0xd7a3) {
      out += LEAD[Math.floor((code - 0xac00) / 588)];
    } else {
      out += ch;
    }
  }
  return out;
}

/** 질의가 초성만으로 이뤄졌나 (`ㅎ`, `ㄱㅅ`). 그럴 때만 초성 검색을 켠다. */
export function isJamoQuery(q: string): boolean {
  return q.length > 0 && /^[ㄱ-ㅎ]+$/.test(q);
}

/** 0 = 문자열 맨 앞, 1 = 단어 맨 앞, 2 = 가운데, -1 = 없음. 작을수록 위로 온다. */
export function matchRank(haystack: string, needle: string): number {
  if (!needle) return 0;
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  const i = h.indexOf(n);
  if (i < 0) return -1;
  if (i === 0) return 0;
 // 단어 맨 앞: 공백뿐 아니라 흔한 구분자(., _, -, @) 뒤도 단어의 시작으로 본다
  return /[\s._\-@]/.test(h[i - 1]) ? 1 : 2;
}

/** 한 사람에 대한 최종 등급 — 이름과 이메일 중 더 좋은 쪽. 초성 질의면 초성으로도 본다. */
export function personRank(p: MentionPerson, query: string): number {
  const q = query.trim();
  if (!q) return 0;
  const fields = [p.displayName ?? "", p.email ?? ""];
  let best = -1;
  for (const f of fields) {
    const r = matchRank(f, q);
    if (r >= 0 && (best < 0 || r < best)) best = r;
  }
  if (isJamoQuery(q)) {
    const r = matchRank(leadJamo(p.displayName ?? ""), q);
    if (r >= 0 && (best < 0 || r < best)) best = r;
  }
  return best;
}

export interface RankedPeople {
  /** 화면에 그리는 사람들 (최대 PEOPLE_SHOWN). */
  shown: MentionPerson[];
  /** `N개 결과 더 보기` 의 N. 0이면 그 줄이 없다. */
  more: number;
  /** 접기 전 전체. `더 보기` 를 누르면 이걸 다 그린다. */
  all: MentionPerson[];
}

/**
 * 원본 순서대로 정렬해 5개까지 자른다.
 *
 * `meId` 는 "나"다 — 같은 등급 안에서 위로 온다(원본은 이름 뒤에 `(나)` 를 붙인다).
 * 자기 자신을 빼지 않는 것도 원본과 같다: 노션은 `@` 목록 첫 줄에 나를 보여준다.
 */
export function rankPeople(
  people: MentionPerson[],
  query: string,
  meId?: string | null,
  limit: number = PEOPLE_SHOWN
): RankedPeople {
  const scored = people
    .map((p, i) => ({ p, i, rank: personRank(p, query) }))
    .filter((e) => e.rank >= 0);

  scored.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    const aMe = meId != null && a.p.id === meId ? 0 : 1;
    const bMe = meId != null && b.p.id === meId ? 0 : 1;
    if (aMe !== bMe) return aMe - bMe;
    const aGuest = a.p.role === "guest" ? 1 : 0;
    const bGuest = b.p.role === "guest" ? 1 : 0;
    if (aGuest !== bGuest) return aGuest - bGuest;
    return a.i - b.i;
  });

  const all = scored.map((e) => e.p);
  return { shown: all.slice(0, limit), more: Math.max(0, all.length - limit), all };
}

/* ────────────────────────────────────────────────────────────────────────── */

export interface MentionQuery {
  /** 여는 `@` 의 인덱스. */
  at: number;
  /** `@` 뒤부터 캐럿까지 — **공백을 포함할 수 있다**. */
  query: string;
}

/**
 * 캐럿 위치에서 열려 있어야 할 멘션 질의. 없으면 null.
 *
 * 측정한 규칙(§1):
 *  · 단어 경계를 따지지 않는다 — `x@` 도 연다.
 *  · **`@` 바로 뒤의 공백만** 취소다(`@ ` → 닫힘).
 *  · 그 뒤의 공백은 질의의 일부다 — `@hyeon jeong` 은 열린 채로 계속 찾는다.
 *    (우리 블록 편집기는 지금 공백만 보이면 닫는데, 그게 원본과 다른 부분이다.)
 */
export function mentionQueryAt(text: string, caret: number): MentionQuery | null {
  if (caret < 0 || caret > text.length) return null;
  const at = text.lastIndexOf("@", caret - 1);
  if (at < 0) return null;
  const query = text.slice(at + 1, caret);
  if (/^[\s\u00a0]/.test(query)) return null; // `@ ` — 바로 뒤가 공백이면 취소
  if (query.includes("\n")) return null;
  return { at, query };
}

/**
 * 이미 넣은 멘션은 **통째로 하나**다 — 원본 토큰이 `contenteditable="false"` 라
 * Backspace 한 번에 전체가 사라진다(§5). 평문 입력줄에서 그걸 흉내내려면
 * "캐럿 바로 앞이 넣어둔 `@이름` 인가"를 물어야 한다.
 *
 * 가장 긴 이름부터 본다 — `@Kim` 과 `@Kim San` 이 둘 다 있으면 긴 쪽이 맞다.
 */
export function mentionRunBefore(
  text: string,
  caret: number,
  labels: string[]
): { start: number; end: number; label: string } | null {
  const head = text.slice(0, caret);
  let best: { start: number; end: number; label: string } | null = null;
  for (const label of labels) {
    const token = `@${label}`;
    if (!head.endsWith(token)) continue;
    if (best && best.label.length >= label.length) continue;
    best = { start: caret - token.length, end: caret, label };
  }
  return best;
}
