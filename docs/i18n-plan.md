# Language settings design (i18n)

Written 2026-08-26. Every observation of the original comes from `docs/settings_my_settings.html` and values measured over CDP that day.

> **Update 2026-09-25: English is now the source language.** UI strings are written in English in the code (`t("Add icon")`), and Korean is a translation dictionary, `app/src/i18n/ko.ts` (`{ "Add icon": "<Korean>" }`). `en.ts` no longer exists. Outside `app/src/i18n/`, the repository contains no Korean. D3 below records the original Korean-keyed decision and the flip.

## 1. How Notion does it (observed)

- **Entry path**: click the workspace switcher at the top left → menu `Upgrade / Settings / Invite members / Add another account / (workspace list) / Add a workspace / Log out` → `Settings`.
  The sidebar body has **no** `Settings` row (the bottom has `Help / Trash`).
- **Settings modal** (`aria-label` is the "Settings & members" label): 90vw (max 1512) × (100%-100px), r12. Vertical tabs, 240px, on the left.
  - `Account`: profile (name) · **Preferences** · Notifications · Mail & Calendar
  - `Workspace`: General · People · Import / `Features`: Notion AI · Connections · MCP · Public pages · Emoji · Developers / Teamspaces / Plans
- **Where language lives**: `Preferences` tab → sections `Appearance / Input options / **Language & Time** / Desktop app / Start page / Privacy`.
  Inside `Language & Time`: **Language** (dropdown) · Number format · Text direction · Start week on · Date format · Time zone.
- **Scope**: per account (user), not per workspace. 22 languages; each dropdown item is two lines (43px): the native name and the name in the current language.
- **What it applies to**: every UI string plus the default date and number formats. User content (page titles, body) naturally does not change.
  However, **template/default strings** (the `Name` and `Tags` property names of a new DB, `Untitled`, `New page`) are **baked into content** in the language active when they were created.

## 2. Where we stand (as of 2026-08-26)

- No i18n layer. Hardcoded strings ≈ 131 JSX text + 231 placeholder/title/aria + 161 `label:` + toasts etc. ≈ **600**.
- 27 files mostly Korean, 30 mostly English. The boundary is "places matched against original captures (Korean) vs places built without captures (English)".
- Dates are fixed by `const LOCALE="ko-KR"` in `src/lib/date-format.ts`; besides that, `toLocaleString("en-US")` is scattered over 6 places.
- Settings UI: `profile-settings.tsx` (name editing, a row at the bottom of the sidebar) and `workspace-settings-modal.tsx` (opened from the switcher menu). No Notion-style unified settings modal.
- The `users` table has no language column. `<html lang>` is not set.

## 3. Decisions and recommendations

### D1. Scope of the language setting → **per user** (same as Notion)
`users.language text` (null = not set). No workspace default language.
When not set: browser `Accept-Language` → use it if it is a supported language, otherwise `ko` (team default).
Applied immediately on save (no reload), and copied into the `lang` cookie so server rendering (first paint, `<html lang>`) matches without flicker.

### D2. Entry path → **switcher menu `Settings` → unified settings modal**, only two tabs at first
We do not build all of Notion's nav. `Account: My account (name, avatar) / Preferences` + `Workspace: General (content moved from the existing workspace-settings-modal)`.
`Preferences` only holds `Appearance` (moved from the existing DarkModeToggle) and `Language & Time` (language only; start of week and time zone later).
The `ProfileSettings + DarkModeToggle + Log out` row at the bottom of the sidebar is removed after being absorbed into the modal (the original has no such row).
Dimensions follow the capture (modal, nav 240, tab 28, section title 16/24, row label 14/20, dropdown 28h r6); compare with `e2e/settings-modal.check.mjs` when implementing.

### D3. String system → **no `next-intl`; our own lightweight dictionary** (one file per language)
Reasons: (a) no need to move App Router routing to `/[locale]/`; our URLs (`/p/<id>`) stay as they are. (b) Originally (2026-08-26), because the source for comparison work was the Korean capture, **keys were the original Korean text rather than English slugs**, so captures and code read 1:1 and naming keys cost nothing.

**Flipped 2026-09-25: keys are now English source text.** The owner decided the repository should contain no Korean outside `app/src/i18n/`. Every `t("<Korean>")` call site was rewritten to its English string, `en.ts` was removed, and `ko.ts` became the Korean dictionary over English keys. Korean content that is Korean by nature (demo family names, seeded paths, golden-set expected strings, IME test input) moved to modules under `app/src/i18n/content/`.

```ts
// src/i18n/ko.ts  — Korean dictionary over English keys: { "Add icon": "<Korean>", "Add cover": "<Korean>", ... }
// usage:  t("Add icon")   /  t("{n} selected", { n })
// locale ko → the ko.ts value; any other locale → the key itself (English)
```
- `t()` is the same dictionary for the client hook `useT()`, server-side `getT()`, and `makeT(locale)` where code picks the language itself (agent replies). A key missing from `ko.ts` **falls back to the English source** (never blank).
- Plurals and gender use separate keys (`"1 item"`, `"{n} items"`) instead of ICU when needed; ICU is overkill unless we plan all 22 languages.
- Missing-translation check by script: `node scripts/i18n-keys.mjs` greps `t("…")` calls and reports keys that are not in `ko.ts`.
- Dates and numbers pass `users.language` to `Intl`. Replace the `LOCALE` constant in `date-format.ts` with a hook and gather the 6 scattered `"en-US"` uses into one place.

### D4. Languages in the first release → **ko + en (US)** only
The dropdown uses Notion's two-line `native name | name in current language` form, with two items. Other languages come by adding one dictionary file.

### D5. Default strings baked into content → like Notion, **stored in the language active at creation**
New DB property names such as `Name` and `Untitled` store the result of `t()` at creation time. Changing the language later does not change them (same as the original, and what users expect).
But the **display fallback** (the `Untitled` shown for a page with an empty title) is rendering, not storage, so it follows the current language.

### D6. Order for cleaning up the Korean/English mix
1. Introduce the dictionary + `t()` plumbing (0 strings moved, no behaviour change)
2. The 30 files still in English → replace with Korean source keys (at this point the UI is unified in Korean)
3. Fill `en.ts`: wording that has a capture follows Notion's English edition (needs confirmation, see open questions below); the rest written directly
4. Settings modal + `users.language` + cookie/`<html lang>`
5. Wire up date and number locales

## 4. Open questions (human decisions)

- Q1. Should English translations follow **Notion's English-edition wording**? That requires briefly switching the original account's language to English and capturing the same screens (changing original settings; by the rules, a human does it).
- Q2. Do we agree to remove the sidebar bottom row (name, dark mode, log out) and move everything to the modal? (Log out goes to the switcher menu, like Notion.)
- Q3. Should the rest of `Language & Time` (start of week, time zone, date format) go in now, or language only first? Recommendation: language only.

## 5. Decisions (2026-08-26)
- Q1: Use Notion's English edition as the reference. comcom switches the original account to English to allow capture time, then switches it back to Korean. Until then, `en.ts` is not filled.
- Q2: Remove the sidebar bottom row (name, dark mode, log out) and move it to the modal / switcher menu. Agreed.
- Q3: `Language & Time` gets **language only**. Start of week, time zone, and date format come later.

## 6. Progress (2026-08-26)
- [x] D6-1 dictionary plumbing: `src/i18n/` (`useT`/`getT`/`useIntlLocale`, `lang` cookie, `<html lang>`), `users.language` — `933500c`
- [x] D6-4 settings modal (My account · Preferences · General) + language dropdown, switcher menu order, sidebar bottom row removed — `5394b90`
- [x] D6-5 date and number locales (`date-format.ts`, `dates.ts`, scattered `en-US`) — `612be96`, `8915c61`
- [x] D6-2 Korean unification: 695 keys pass through `t()`. Check: `node scripts/i18n-keys.mjs` — `8915c61`
- [x] D6-3 fill `en.ts`: 699 entries based on the vocabulary of the English-edition captures in `docs/en/` (2026-08-26). 0 missing (`node scripts/i18n-keys.mjs`). The same script reports new keys.
- [x] (2026-09-25) Source language flipped to English: `t()` keys are English, `en.ts` removed, `ko.ts` is the Korean dictionary (see D3). `node scripts/i18n-keys.mjs` now reports keys missing from `ko.ts`.

### D5 settled (2026-08-26, same as Notion)
- **An empty page title is not stored** (`""`). The display fallback (`Untitled`, or its Korean dictionary entry) follows the current language via `pageLabel()` + `t()`. Removed the places where chat "Turn into page" and row page creation stored `Untitled` or its Korean equivalent.
- **Property, status option, and view names are stored in the language active at creation**: `provisionDatabase(…, t)` receives `getT(user.language)` and inserts `Name/Status/Assignee/Due date`, `To do/In progress/Done`, `Table/Board` in that language. A property added through the type picker also gets the type label of that moment.
- The `Untitled` text in a mention chip is baked into the block HTML (Notion also stores mention text as content).
- Server-only fallbacks (export file names, the search index, the `Untitled` in MCP slugs) are files/identifiers, not display, so they stay in English.
