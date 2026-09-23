"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { MentionMenu, type MentionItem } from "@/components/editor/mention-menu";
import { mentionQueryAt, mentionRunBefore } from "@/lib/mention/search";
import { useImeGuard } from "@/hooks/use-ime-guard";

/**
 * A comment input line that can mention people — the same behaviour Notion's
 * comment composer was measured to have on 2026-09-10
 * (docs/notion-comment-mention.md, e2e/fixtures/notion-comment-mention.json).
 * All three of our comment surfaces use it, so they behave alike:
 *
 *  · `@` opens the menu wherever it is typed — Notion does NOT ask for a word
 *    boundary, so `x@` opens it too. Only a space **immediately** after the
 *    `@` closes it; every space after that is part of the query
 *    (`@kim s` keeps searching). That whole rule is `mentionQueryAt`.
 *  · ↓/↑ walk the flat list across sections, Enter PICKS (it must not send),
 *    Escape closes the menu and leaves the typed text where it is.
 *  · picking writes `@Name ` — the name and one trailing space — and remembers
 *    WHAT was picked (person, page or date). Remembering only people left the
 *    menu open on the text a page/date pick had just written.
 *  · a picked mention is one thing: with the caret right behind `@Name`, one
 *    Backspace eats all of it (the space before it went with the previous
 *    Backspace, which is the two-press order measured in the original).
 *
 * What we cannot copy in an `<input>`: the original's token is a real
 * contenteditable=false node. Here it is plain text, so "is the caret behind a
 * mention" is answered by `mentionRunBefore` against the labels we picked.
 */
export interface PickedMention {
  id: string;
  label: string;
 // person · page · date. Only people are notified, but all three have to be
 // remembered: they are what tells a finished mention from a live query.
  kind: "person" | "page" | "date";
}

export interface MentionInputHandle {
  focus: () => void;
  /** the `@` button: the original really inserts the character (§1) */
  insertAt: () => void;
  /** ids still spelled in `text` — the user may have deleted a mention */
  mentionIds: (text: string) => string[];
  /** forget the picked mentions (after a send) */
  clear: () => void;
}

interface MenuState {
  /** index of the opening `@` */
  at: number;
  query: string;
  anchor: { x: number; y: number };
}

export const MentionInput = forwardRef<MentionInputHandle, {
  value: string;
  onChange: (value: string) => void;
  /** Enter with the menu CLOSED (and no IME composition in flight) */
  onSubmit: () => void;
  placeholder?: string;
  className?: string;
  inputTestId?: string;
  autoFocus?: boolean;
}>(function MentionInput(
  { value, onChange, onSubmit, placeholder, className, inputTestId, autoFocus },
  ref
) {
  const input = useRef<HTMLInputElement>(null);
  const ime = useImeGuard();
  const [menu, setMenu] = useState<MenuState | null>(null);
  const menuRef = useRef<MenuState | null>(null);
  menuRef.current = menu;
  const [index, setIndex] = useState(0);
  const items = useRef<MentionItem[]>([]);
  const [picked, setPicked] = useState<PickedMention[]>([]);
  const pickedRef = useRef<PickedMention[]>([]);
  pickedRef.current = picked;
 // the `@` an Escape dismissed: do not reopen on it
  const dismissed = useRef<number | null>(null);
 // where the caret goes once React has written the new value
  const caretAfter = useRef<number | null>(null);

  /**
   * WHERE in the draft the mentions we inserted sit — the `@` offset of each.
   *
   * Positional on purpose. Asking "is this text one of the labels I picked"
   * matched the same name typed out by hand anywhere in the draft, so after
   * deleting a mention and typing the name again the menu never came back.
   * The nth pick of a label claims the nth `@label` in the draft; a hand-typed
   * copy has no pick behind it and stays a live query.
   *
   * It also prunes: a pick whose text is gone from the draft was deleted by
   * the user, so we forget it (that is what lets the name be typed afresh).
   */
  const locate = useCallback((text: string) => {
    const kept: PickedMention[] = [];
    const ats = new Map<number, PickedMention>();
    const from = new Map<string, number>();
    for (const p of pickedRef.current) {
      const at = text.indexOf(`@${p.label}`, from.get(p.label) ?? 0);
      if (at < 0) continue;
      from.set(p.label, at + 1 + p.label.length);
      kept.push(p);
      ats.set(at, p);
    }
    if (kept.length !== pickedRef.current.length) {
      pickedRef.current = kept;
      setPicked(kept);
    }
    return ats;
  }, []);

  const sync = useCallback(
    (el: HTMLInputElement) => {
      const caret = el.selectionStart ?? el.value.length;
      const completed = locate(el.value);
      const q = mentionQueryAt(el.value, caret);
      if (!q) {
 // no run under the caret at all — the `@` an Escape dismissed is gone, so
 // the next one the user types opens the menu again
        dismissed.current = null;
        if (menuRef.current) setMenu(null);
        return;
      }
 // this run IS a mention we inserted — finished text, not a live query
      if (dismissed.current === q.at || completed.has(q.at)) {
        if (menuRef.current) setMenu(null);
        return;
      }
      const prev = menuRef.current;
      if (prev && prev.at === q.at && prev.query === q.query) return;
      setIndex(0);
      setMenu({ at: q.at, query: q.query, anchor: caretPoint(el, q.at) });
    },
    [locate]
  );

 // put the caret where the edit left it, THEN ask whether a menu belongs open
 // (the `@` button opens one this way, a pick closes one)
  useEffect(() => {
    const at = caretAfter.current;
    if (at === null) return;
    caretAfter.current = null;
    const el = input.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(at, at);
    sync(el);
  }, [value, sync]);

 // Escape closes the menu and nothing else. On `window`, capture phase, so it
 // lands BEFORE the document-level dismissers of whatever surface the composer
 // sits in — otherwise the first Escape closed the row-comment popover out
 // from under an open menu.
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      dismissed.current = menu.at;
      setMenu(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [menu]);

  const onItems = useCallback((next: MentionItem[]) => {
    items.current = next;
    setIndex((i) => (next.length === 0 ? 0 : Math.min(i, next.length - 1)));
  }, []);

  function pick(item: MentionItem) {
    const el = input.current;
    if (!el) return;
 // `N개 결과 더 보기` is the menu's own row — it expands the list there and
 // never reaches a caller as a mention
    if (item.kind === "more") return;
    const caret = el.selectionStart ?? el.value.length;
    const q = mentionQueryAt(el.value, caret) ?? (menu ? { at: menu.at, query: menu.query } : null);
    if (!q) return;
    const token = `@${item.label} `;
    const next = el.value.slice(0, q.at) + token + el.value.slice(q.at + 1 + q.query.length);
 // remember the pick — whatever kind it is. `sync` (which runs as soon as the
 // caret lands after the insert) reads this to see that the run under the
 // caret is a finished mention and leaves the menu closed; a person-only list
 // left a page/date pick looking like a live query, so the menu stayed open on
 // the title it had just written. One entry per pick, not one per person: the
 // same name mentioned twice occupies two `@Name` runs.
    const { id, label, kind } = item; // narrowed above; a closure would widen `kind` again
    setPicked((prev) => [...prev, { id, label, kind }]);
    dismissed.current = null;
    setMenu(null);
    caretAfter.current = q.at + token.length;
    onChange(next);
  }

  function onKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    const el = e.currentTarget;

    if (menu) {
      const list = items.current;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (list.length) setIndex((i) => (i + 1) % list.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (list.length) setIndex((i) => (i - 1 + list.length) % list.length);
        return;
      }
      if (e.key === "Enter") {
 // an IME still settling a syllable owns this Enter — it is neither a pick
 // nor a send (e2e/ime-enter.check.mjs)
        if (ime.composing(e)) return;
        const item = list[index] ?? list[0];
        if (item) {
          e.preventDefault();
          pick(item);
          return;
        }
 // nothing to pick — the card is showing `결과 없음`. Swallowing the Enter
 // here made every comment holding an email address unsendable from the
 // keyboard (`hong@example.com` opens a menu on `example.com`), so let it
 // fall through to the send below.
      }
    }

 // a mention is one thing: Backspace behind `@Name` takes all of it
    if (e.key === "Backspace" && el.selectionStart === el.selectionEnd) {
      const caret = el.selectionStart ?? 0;
      const run = mentionRunBefore(el.value, caret, pickedRef.current.map((p) => p.label));
      if (run) {
        e.preventDefault();
        setMenu(null);
        dismissed.current = null;
        caretAfter.current = run.start;
        onChange(el.value.slice(0, run.start) + el.value.slice(run.end));
        return;
      }
    }

    if (e.key === "Enter") {
      if (ime.composing(e)) return;
      e.preventDefault();
      onSubmit();
    }
  }

  useImperativeHandle(
    ref,
    () => ({
      focus: () => input.current?.focus(),
      insertAt: () => {
        const el = input.current;
        if (!el) return;
        const start = el.selectionStart ?? el.value.length;
        const end = el.selectionEnd ?? start;
        dismissed.current = null;
        caretAfter.current = start + 1;
        onChange(`${el.value.slice(0, start)}@${el.value.slice(end)}`);
      },
      mentionIds: (text: string) => {
        const out: string[] = [];
        for (const p of pickedRef.current) {
          if (p.kind !== "person") continue; // a page/date mention notifies nobody
          if (out.includes(p.id)) continue;
          if (!text.includes(`@${p.label}`)) continue;
          out.push(p.id);
        }
        return out;
      },
      clear: () => {
        setPicked([]);
        setMenu(null);
        dismissed.current = null;
      },
    }),
    [onChange]
  );

  return (
    <>
      <input
        ref={input}
        data-testid={inputTestId}
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        className={className}
        onChange={(e) => {
          onChange(e.target.value);
          sync(e.currentTarget);
        }}
        onKeyUp={(e) => sync(e.currentTarget)}
        onClick={(e) => sync(e.currentTarget)}
        onBlur={(e) => {
 // clicking a row keeps the caret (mousedown is prevented there); the date
 // picker inside the menu does take focus, and that must not close it
          const next = e.relatedTarget as HTMLElement | null;
          if (next?.closest?.('[data-testid="mention-menu"]')) return;
          setMenu(null);
        }}
        {...ime.imeProps}
        onKeyDown={onKeyDown}
      />
      {menu && (
        <MentionMenu
          portal
          anchor={menu.anchor}
          query={menu.query}
          selectedIndex={index}
          onItems={onItems}
          onPick={pick}
          onHover={setIndex}
        />
      )}
    </>
  );
});

/**
 * Where the caret is, in window coordinates — an `<input>` will not say, so a
 * hidden mirror measures the text before it in the input's own font. The menu
 * hangs from the opening `@` rather than the moving caret so it does not slide
 * sideways with every letter typed.
 */
function caretPoint(el: HTMLInputElement, index: number): { x: number; y: number } {
  const box = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const mirror = document.createElement("div");
  mirror.style.position = "fixed";
  mirror.style.top = "0";
  mirror.style.left = "0";
  mirror.style.visibility = "hidden";
  mirror.style.whiteSpace = "pre";
  mirror.style.pointerEvents = "none";
  mirror.style.fontFamily = cs.fontFamily;
  mirror.style.fontSize = cs.fontSize;
  mirror.style.fontWeight = cs.fontWeight;
  mirror.style.fontStyle = cs.fontStyle;
  mirror.style.letterSpacing = cs.letterSpacing;
  mirror.style.textTransform = cs.textTransform;
  mirror.textContent = el.value.slice(0, index);
  document.body.appendChild(mirror);
  const width = mirror.getBoundingClientRect().width;
  mirror.remove();

  const left =
    box.left +
    parseFloat(cs.borderLeftWidth || "0") +
    parseFloat(cs.paddingLeft || "0") -
    el.scrollLeft +
    width;
 // never outside the field itself — a long line scrolls under the caret
  return { x: Math.min(Math.max(left, box.left), box.right), y: box.top };
}
