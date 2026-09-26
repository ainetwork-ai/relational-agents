"use client";

import { EmojiFaceIcon } from "@/components/icons/page-controls";
import { isImeComposing } from "@/hooks/use-ime-guard";
import { useEffect, useRef, useState } from "react";
import {
  X,
  Maximize2,
  ChevronUp,
  ChevronDown,
  Star,
  Plus,
} from "lucide-react";
import { useRouter } from "next/navigation";
import type { Block, DbProperty, Page, PropertyType } from "@/lib/db/schema";
import { useDb } from "./database-block";
import {
  PINNED_COUNT,
  PanelCloseButton,
  RowDetailsPanel,
  RowPropertyBlock,
  splitPinned,
} from "./row-property-block";
import { useDismiss } from "@/hooks/use-dismiss";
import { CustomizeLayoutList } from "./customize-layout";
import { BlockEditor } from "@/components/editor/block-editor";
import { IconPicker } from "@/components/page/icon-picker";
import { SharePopover } from "@/components/page/share-popover";
import { PageOptionsMenu } from "@/components/page/page-options";
import { CopyLinkButton, CoverControls, editedAgo } from "@/components/page/page-view";
import { CommentThreadPanel } from "@/components/comments/comment-thread-panel";
import { useCommentUi, PAGE_ANCHOR } from "@/stores/comment-ui";
import { usePagesStore } from "@/stores/pages";
import { useT } from "@/i18n/provider";
import { KO_ITEM_NAME_NEW_PREFIX } from "@/i18n/content/database";

const ITEM_NAME_NEW_PREFIX_RE = new RegExp(`^${KO_ITEM_NAME_NEW_PREFIX}\\s*`);

// Measured on the original 2026-08-10 (Projects row peek, windows 1000/1200/1500/1800):
// the peek is exactly 50% of the window, floor 564px (a 1000 window gave 564).
const MIN_WIDTH = 564;
const DEFAULT_FRACTION = 0.5;
/** View details in a peek (measured 2026-08-27 at 1000–1800): the panel is 280px
 *  (+1px divider) and the peek GROWS leftwards by that much, so the page column
 *  keeps its width — except that a window of 1200 gave 800 both times (564 and
 *  600 base): once `window - 400` is at least 800 the peek is capped there and
 *  the column gives way instead. At 1100 it was 844, uncapped. */
const DETAILS_WIDTH = 280;
const DETAILS_CAP_MARGIN = 400;
const DETAILS_CAP_MIN = 800;

/** The Type list of the original's Add-a-property popover, in its order and
 *  wording (docs/database_row_addproperty_menu.html). `type: null` marks the
 *  three we have no column for — shown, but inert, so the list still reads as
 *  the same list. */
const TYPE_CHOICES: { type: PropertyType | null; label: string }[] = [
  { type: "text", label: "Text" },
  { type: "number", label: "Number" },
  { type: "select", label: "Select" },
  { type: "multi_select", label: "Multi-select" },
  { type: "status", label: "Status" },
  { type: "date", label: "Date" },
  { type: "person", label: "Person" },
  { type: "files", label: "Files & media" },
  { type: "checkbox", label: "Checkbox" },
  { type: "url", label: "URL" },
  { type: "email", label: "Email" },
  { type: "phone", label: "Phone" },
  { type: "formula", label: "Formula" },
  { type: "relation", label: "Relational" },
  { type: "rollup", label: "Rollup" },
  { type: "created_time", label: "Created time" },
  { type: "created_by", label: "Created by" },
  { type: "last_edited_time", label: "Last edited time" },
  { type: "last_edited_by", label: "Last edited by" },
  { type: null, label: "Button" },
  { type: null, label: "Place" },
  { type: null, label: "ID" },
];

/**
 * A database row opened as a page, in Notion's SIDE PEEK: a panel docked to the
 * right edge for the window's full height, resizable by its left edge, with the
 * table still visible (and unclouded — a side peek dims nothing) behind it.
 *
 * Modelled on docs/database_tableview_newpage.html: Close · Open as full page ·
 * Previous/Next page on the left of the header, Share · Copy link · Favorite · Actions on the
 * right; then Add icon / Add cover, a 32px title, the row's properties with
 * Add a property, a Comments section, and the page body.
 */
export function RowPeek({
  rowId,
  onClose,
  autoFocusTitle,
}: {
  rowId: string;
  onClose: () => void;
 // set when the peek was opened by creating the row: the original lands you in
 // the title with the caret already there, ready to be named
  autoFocusTitle?: boolean;
}) {
  const db = useDb();
  const t = useT();
  const router = useRouter();
  const row = db.rows.find((r) => r.id === rowId);
  const titleProp = db.properties.find((p) => p.type === "title");
  const bodyPageId = typeof row?.values["__page"] === "string" ? row.values["__page"] : null;
  const [loaded, setLoaded] = useState<{
    pageId: string;
    page: Page | null;
    blocks: Block[];
  } | null>(null);
 // derived, not reset in an effect: stepping to the next entry must not show
 // the previous one's body for a frame — and must never hand the editor blocks
 // that belong to another page
  const fetched = loaded && loaded.pageId === bodyPageId ? loaded : null;
  const blocks = fetched?.blocks ?? null;
 // How the original lays a row's page out (measured 2026-08-06 by creating a
 // row in it and capturing: docs/database_tableview_newpage2.html and
 // …_details.html, plus screenshots of the collapsed state):
 //
 //   New project              ← title, placeholder is New + the item name
 //   View details             ← toggle
 //   TL   Assignee   End date   Evaluation      ← a few pinned properties,
 //   Empty Empty      Empty      Empty           side by side, label over value
 //   Comments
 //   (body)
 //
 // and View details opens a 380px panel down the peek's right edge headed Properties,
 // holding every other property plus Add a property. Nothing is hidden for
 // being empty — the split is pinned vs not.
 //
 // An earlier pass here read the FIRST capture of this screen as "a new row
 // shows no properties at all" and hid the empty ones. That capture had been
 // saved before the properties rendered; the live original shows them.
  const [detailsOpen, setDetailsOpen] = useState(false);
 // the header's Customize layout menu — a pinned label's menu opens the same one
  const [layoutOpen, setLayoutOpen] = useState(false);
 // Close panel lives in the header but belongs to the Properties panel: the original shows
 // it while the panel is hovered (and while the header itself is, so the
 // pointer can travel from one to the other without it vanishing underfoot)
  const [panelHovered, setPanelHovered] = useState(false);
  const [headerHovered, setHeaderHovered] = useState(false);
  const showPanelClose = detailsOpen && (panelHovered || headerHovered);
 // the store carries live edits (favourite, icon, cover) for pages it knows
  const storePage = usePagesStore((s) => (bodyPageId ? s.pages[bodyPageId] : undefined));
  const updatePage = usePagesStore((s) => s.updatePage);
  const openComments = useCommentUi((s) => s.open);
  const page = storePage ?? fetched?.page ?? null;

 // Width: the capture's 861px is ~51% of its window. Remembered per browser,
 // like the sidebar's.
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
 // deferred so no setState runs synchronously in the effect body (the same
 // shape the sidebar uses to restore its own remembered width)
    void Promise.resolve().then(() => {
      const saved = Number(localStorage.getItem("row-peek-width"));
      const max = window.innerWidth - 120;
      setWidth(
        saved >= MIN_WIDTH && saved <= max
          ? saved
          : Math.max(MIN_WIDTH, Math.round(window.innerWidth * DEFAULT_FRACTION))
      );
    });
  }, []);
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const move = (ev: PointerEvent) => {
      const next = Math.min(window.innerWidth - 120, Math.max(MIN_WIDTH, window.innerWidth - ev.clientX));
      setWidth(next);
      try {
        localStorage.setItem("row-peek-width", String(next));
      } catch {}
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  useEffect(() => {
    if (!bodyPageId) return;
    let alive = true;
    void Promise.all([
      fetch(`/api/pages/${bodyPageId}`).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/pages/${bodyPageId}/blocks`).then((r) => (r.ok ? r.json() : { blocks: [] })),
    ]).then(([p, b]) => {
      if (!alive) return;
      setLoaded({ pageId: bodyPageId, page: p?.page ?? null, blocks: b?.blocks ?? [] });
    });
    return () => {
      alive = false;
    };
  }, [bodyPageId]);

  useEffect(() => {
 // the editor consumes Escape for its own layers (slash menu, block
 // selection) and preventDefaults it — one Escape must not also close the peek
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

 // Previous / Next page — step through the rows the way the view lists them.
 // Template rows are definitions, not entries, so they are not stops.
  // A trashed entry (values.__archived) is gone from every view, so it is not a stop either.
  const stops = db.rows.filter((r) => !r.values.__template && !r.values.__archived);
  const at = stops.findIndex((r) => r.id === rowId);
  const prev = at > 0 ? stops[at - 1] : null;
  const next = at >= 0 && at < stops.length - 1 ? stops[at + 1] : null;

  if (!row) return null;

  return (
 // No scrim: a side peek leaves the page it sits over legible (the centre
 // peek is the one that dims). The full-screen layer only catches the click
 // that dismisses it.
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div
        data-testid="db-row-peek"
        data-page-id={bodyPageId ?? undefined}
        role="region"
        aria-label={t("Side Peek")}
        onClick={(e) => e.stopPropagation()}
        style={
          width
            ? {
                width: detailsOpen
                  ? window.innerWidth - DETAILS_CAP_MARGIN >= DETAILS_CAP_MIN
                    ? Math.min(width + DETAILS_WIDTH, window.innerWidth - DETAILS_CAP_MARGIN)
                    : width + DETAILS_WIDTH
                  : width,
              }
            : { width: `${DEFAULT_FRACTION * 100}%` }
        }
        className="peek-anim-right absolute bottom-0 right-0 top-0 flex flex-col overflow-hidden rounded-tl-xl border-l border-neutral-200 bg-white shadow-2xl dark:border-neutral-700 dark:bg-[#191919]"
      >
        <div
          data-testid="db-row-peek-resize"
          onPointerDown={startResize}
          role="separator"
          aria-orientation="vertical"
          aria-label={t("Resize with left and right arrow keys")}
          className="absolute inset-y-0 left-0 z-10 w-3 cursor-col-resize hover:bg-blue-300/40"
        />

        <div
          className="flex h-11 shrink-0 items-center justify-between gap-1 pl-4 pr-2.5"
          onMouseEnter={() => setHeaderHovered(true)}
          onMouseLeave={() => setHeaderHovered(false)}
        >
          <div className="flex items-center gap-0.5">
            <PeekButton testid="db-peek-close" label={t("Close")} onClick={onClose}>
              <X size={16} />
            </PeekButton>
            {bodyPageId && (
              <PeekButton
                testid="db-peek-open-full"
                label={t("Open as full page")}
                onClick={() => router.push(`/p/${bodyPageId}`)}
              >
                <Maximize2 size={14} />
              </PeekButton>
            )}
            <span
              aria-hidden="true"
              className="mx-1 h-3.5 w-px shrink-0 bg-neutral-200 dark:bg-neutral-700"
            />
            <PeekButton
              testid="db-peek-prev"
              label={t("Previous page")}
              disabled={!prev}
              onClick={() => prev && db.openRow(prev.id)}
            >
              <ChevronUp size={16} />
            </PeekButton>
            <PeekButton
              testid="db-peek-next"
              label={t("Next page")}
              disabled={!next}
              onClick={() => next && db.openRow(next.id)}
            >
              <ChevronDown size={16} />
            </PeekButton>
          </div>
          <div className="flex items-center gap-0.5">
            {/* Close panel — first in this group, only while the Properties panel (or this
                bar) is hovered; measured 2026-08-27: 24×24, 6px corners, y 10 */}
            {showPanelClose && (
              <PanelCloseButton onClick={() => setDetailsOpen(false)} className="mr-1" />
            )}
            {/* the capture keeps the edit stamp here, left of Share */}
            {page && editedAgo(page.updatedAt) && (
              <span
                data-testid="db-peek-edited-ago"
                suppressHydrationWarning
                className="mr-1 hidden text-xs text-neutral-400 sm:block"
              >
                {editedAgo(page.updatedAt)}
              </span>
            )}
            {bodyPageId && <SharePopover pageId={bodyPageId} />}
            {bodyPageId && <CopyLinkButton pageId={bodyPageId} />}
            {page && bodyPageId && (
              <PeekButton
                testid="db-peek-favorite"
                label={page.isFavorite ? t("Remove from Favorites") : t("Favorites")}
                onClick={() => updatePage(bodyPageId, { isFavorite: !page.isFavorite })}
              >
                <Star
                  size={15}
                  className={page.isFavorite ? "fill-yellow-400 text-yellow-500" : undefined}
                />
              </PeekButton>
            )}
            {/* Moving to Trash closes this peek — the deleted row's page is not
                left open (same onClose as the Close button) */}
            {page && <PageOptionsMenu page={page} onDeleted={onClose} />}
          </div>
        </div>

        {/* body beside the Properties panel: the peek keeps its width, so opening the
            panel narrows the page column rather than widening the peek */}
        <div className="flex min-h-0 flex-1">
        <div className="flex-1 overflow-y-auto pb-[120px]">
          {page?.coverUrl && bodyPageId && (
            <CoverControls
              coverUrl={page.coverUrl}
              onSet={(url) => updatePage(bodyPageId, { coverUrl: url })}
            />
          )}
          {/* Body inset: the original keeps 76px on both sides whatever the peek width
              (76 at every window measured, 1000–1800 — the extra 16 on the right was an emulated scrollbar) */}
          <div className="group/peekhead px-[76px]">
            {page?.icon && bodyPageId && (
              <div className={page.coverUrl ? "-mt-8" : "pt-8"}>
                <IconPicker
                  icon={page.icon}
                  allowImage
                  triggerClassName="rounded-md p-1 text-5xl leading-none transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  onChange={(icon) => updatePage(bodyPageId, { icon })}
                />
              </div>
            )}
            {/* Add icon · Add cover — the same hover row a page has, minus description
                (a description belongs to the database, not to one of its rows) */}
            {bodyPageId && (
              <div
                className={`flex items-center gap-1 touch-reveal opacity-0 transition-opacity focus-within:opacity-100 group-hover/peekhead:opacity-100 ${
                  page?.icon ? "pt-1" : page?.coverUrl ? "pt-2" : "pt-8"
                }`}
              >
                {!page?.icon && (
                  <IconPicker
                    icon={null}
                    allowImage
                    placeholder={<span className="flex items-center gap-1.5 text-sm text-neutral-400"><EmojiFaceIcon /> {t("Add icon")}</span>}
                    triggerClassName="rounded px-1.5 py-0.5 transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800"
                    onChange={(icon) => updatePage(bodyPageId, { icon })}
                  />
                )}
                {!page?.coverUrl && (
                  <CoverControls
                    coverUrl={null}
                    onSet={(url) => updatePage(bodyPageId, { coverUrl: url })}
                  />
                )}
                {/* In the capture, beside Add cover */}
                <CustomizeLayout open={layoutOpen} onOpenChange={setLayoutOpen} />
              </div>
            )}

            {/* The title is the row's title PROPERTY (the table shows the same
                value), rendered as a page title rather than as a cell. */}
            {titleProp && (
              <div>
                <PeekTitle
                  value={String(row.values[titleProp.id] ?? "")}
                  autoFocus={autoFocusTitle}
 // New + what one row is called: the original's Projects reads New project
                  placeholder={t("New {name}", { name: db.itemName.replace(ITEM_NAME_NEW_PREFIX_RE, "") })}
                  onCommit={(v) => db.updateRow(rowId, { [titleProp.id]: v })}
                />
              </div>
            )}

            {/* toggle · pinned band · Comments · body — the same block a full page
                draws (row-property-block.tsx), measured on the original */}
            <RowPropertyBlock
              row={row}
              surface="peek"
              detailsOpen={detailsOpen}
              onToggleDetails={() => setDetailsOpen((v) => !v)}
              commentsPageId={bodyPageId}
            >
              {bodyPageId && blocks ? (
                // keyed: the editor seeds its state from initialBlocks once, so
                // a new entry needs a new instance
                <BlockEditor
                  key={bodyPageId}
                  pageId={bodyPageId}
                  initialBlocks={blocks}
                  emptyVariant="row"
                />
              ) : (
                <div className="h-16 animate-pulse rounded bg-neutral-100 dark:bg-neutral-800" />
              )}
            </RowPropertyBlock>
          </div>
        </div>
        {detailsOpen && (
 // 280px + a 1px divider, its own scroller (the 2026-08-06 capture's 380 is no
 // longer what the original draws). The peek widened by the same amount above,
 // so the page column keeps its width unless the window cap bit.
          <RowDetailsPanel
            row={row}
            className="w-[281px] shrink-0 border-l border-[rgba(55,53,47,0.09)] pb-6 pl-5 pr-4 dark:border-neutral-700"
            footer={<AddPropertyControl />}
            onHoverChange={setPanelHovered}
          />
        )}
        </div>
        {bodyPageId && <CommentThreadPanel pageId={bodyPageId} />}
      </div>
    </div>
  );
}

/** The peek header's Customize layout button — the list itself is shared with
 *  the pinned label's menu (customize-layout.tsx). */
function CustomizeLayout({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const t = useT();
  const boxRef = useRef<HTMLDivElement | null>(null);
  useDismiss(open, () => onOpenChange(false), boxRef);

  return (
    <div className="relative" ref={boxRef}>
      <button
        data-testid="db-peek-customize-layout"
        onClick={() => onOpenChange(!open)}
        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-sm text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800"
      >
        {t("Customize layout")}
      </button>
      {open && (
        <div
          data-testid="db-peek-layout-menu"
          className="popover-anim absolute left-0 top-8 z-50 max-h-[380px] w-[260px] overflow-y-auto rounded-lg border border-neutral-200 bg-white py-1 shadow-xl dark:border-neutral-700 dark:bg-neutral-800"
        >
          <CustomizeLayoutList />
        </div>
      )}
    </div>
  );
}

/**
 * `Add a property` at the foot of the Properties panel, and the popover it opens.
 *
 * Taken from three captures of the original (docs/database_row_addproperty_*):
 * the popover leads with a **name** field — not a type search: typing `Te` and
 * then choosing Text produced a property called `Te`, and the Type list stayed
 * at all 22 entries throughout. Nothing exists until a type is chosen (the
 * panel is unchanged while the popover is open); choosing one creates the
 * property at the END of the list, right above this button, and the same
 * popover becomes its editor — Type, AI autofill, Duplicate property, Delete property.
 *
 * AI autofill (Summary · Translation), the Connections section (Google Drive · Figma) and
 * Duplicate property are drawn disabled: they are in the original's popover and leaving
 * them out would misrepresent it, but none of them are built.
 */
function AddPropertyControl() {
  const db = useDb();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
 // set once a type is picked: the popover stops offering types and starts
 // editing what it just made
  const [madeId, setMadeId] = useState<string | null>(null);
  const made = madeId ? db.properties.find((p) => p.id === madeId) ?? null : null;
  const boxRef = useRef<HTMLDivElement | null>(null);

  const close = () => {
    setOpen(false);
    setName("");
    setMadeId(null);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  const pick = async (type: PropertyType, label: string) => {
 // an unnamed property takes the type's name, which is what the original
 // does when you choose without typing
    const created = await db.addProperty(name.trim() || label, type);
    if (created) setMadeId(created.id);
  };

  return (
    <div className="relative" ref={boxRef}>
      <button
        data-testid="db-peek-add-prop"
        onClick={() => (open ? close() : setOpen(true))}
        className="flex h-[34px] items-center gap-1.5 rounded px-1.5 text-sm text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800"
      >
        <Plus size={14} /> {t("Add property")}
      </button>
      {open && (
        <div
          data-testid="db-peek-add-prop-menu"
          className="popover-anim absolute bottom-9 left-0 z-50 max-h-[420px] w-[280px] overflow-y-auto rounded-lg border border-neutral-200 bg-white py-1 shadow-xl dark:border-neutral-700 dark:bg-neutral-800"
        >
          <div className="px-2 pb-1 pt-0.5">
            <input
              autoFocus
              data-testid="db-peek-add-prop-name"
              value={made ? made.name : name}
              placeholder={t("Property name")}
              onChange={(e) =>
                made
                  ? db.updateProperty(made.id, { name: e.target.value })
                  : setName(e.target.value)
              }
              className="w-full rounded border border-neutral-200 px-2 py-1 text-sm outline-none focus:border-blue-400 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
            />
          </div>

          {made ? (
            <>
              <div className="flex items-center justify-between px-3 py-1.5 text-sm text-neutral-500 dark:text-neutral-400">
                <span>{t("Type")}</span>
                <span className="text-neutral-700 dark:text-neutral-200">
                  {(() => {
                    const c = TYPE_CHOICES.find((c) => c.type === made.type);
                    return c ? t(c.label) : made.type;
                  })()}
                </span>
              </div>
              <MenuSection label={t("AI Autofill")} />
              <MenuRow label={t("Duplicate property")} disabled />
              <MenuRow
                label={t("Delete property")}
                testid="db-peek-del-prop"
                onClick={() => {
                  db.deleteProperty(made.id);
                  close();
                }}
              />
            </>
          ) : (
            <>
              <MenuSection label={t("AI Autofill")} />
              <MenuRow label={t("Summary")} badge="Basic" disabled />
              <MenuRow label={t("Translate")} badge="Basic" disabled />
              <MenuSection label={t("Type")} />
              {TYPE_CHOICES.map((c) => (
                <MenuRow
                  key={c.label}
                  label={t(c.label)}
                  testid={c.type ? `db-peek-add-prop-${c.type}` : undefined}
                  disabled={!c.type}
                  onClick={c.type ? () => void pick(c.type as PropertyType, t(c.label)) : undefined}
                />
              ))}
              <MenuSection label={t("Connect")} />
              <MenuRow label={t("Google Drive file")} disabled />
              <MenuRow label={t("Figma file")} disabled />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MenuSection({ label }: { label: string }) {
  return (
    <div className="px-3 pb-0.5 pt-2 text-[11px] font-medium text-neutral-400">{label}</div>
  );
}

function MenuRow({
  label,
  badge,
  disabled,
  onClick,
  testid,
}: {
  label: string;
  badge?: string;
  disabled?: boolean;
  onClick?: () => void;
  testid?: string;
}) {
  const t = useT();
  return (
    <button
      data-testid={testid}
      disabled={disabled}
      aria-disabled={disabled}
      data-tip={disabled ? t("Not created yet") : undefined}
      onClick={onClick}
      className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-sm transition-colors ${
        disabled
          ? "cursor-not-allowed text-neutral-300 dark:text-neutral-600"
          : "text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-700"
      }`}
    >
      <span>{label}</span>
      {badge && (
        <span className="rounded bg-neutral-100 px-1 text-[10px] text-neutral-400 dark:bg-neutral-700">
          {badge}
        </span>
      )}
    </button>
  );
}

/** The row's title, at page scale (32px/700 in the capture) with Notion's
 *  placeholder. Not PropertyCell: a table cell is 14px by design. */
function PeekTitle({
  value,
  onCommit,
  autoFocus,
  placeholder,
}: {
  value: string;
  onCommit: (v: string) => void;
  autoFocus?: boolean;
  placeholder: string;
}) {
  const [draft, setDraft] = useState(value);
  const seen = useRef(value);
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (value !== seen.current) {
      seen.current = value;
      setDraft(value);
    }
  }, [value]);
 // New project → the caret is already in the title, so the name can just be
 // typed. Only on creation: focusing a row you opened to read would steal the
 // caret from the page body.
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);
  return (
    <input
      ref={ref}
      data-testid="db-peek-title"
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
      onKeyDown={(e) => {
        if (!isImeComposing(e) && e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      className="mt-2 w-full bg-transparent text-[32px] font-bold leading-tight text-neutral-900 outline-none placeholder:text-neutral-300 dark:text-neutral-100 dark:placeholder:text-neutral-600"
    />
  );
}

function PeekButton({
  testid,
  label,
  onClick,
  disabled,
  children,
}: {
  testid: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      data-testid={testid}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      data-tip={label}
      className="flex h-7 w-7 items-center justify-center rounded text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-30 disabled:hover:bg-transparent dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
    >
      {children}
    </button>
  );
}
