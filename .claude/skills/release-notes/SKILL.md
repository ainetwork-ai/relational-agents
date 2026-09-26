---
name: release-notes
description: Writes the AINMem deployment announcement for Slack. Reads the commits between the previous deployed image and the current one and lists only the big features a user would notice, one line each, in the "you can now …" register. Use for requests like "deployment announcement", "update notice", "release notes", "what went into this deploy".
---

# Writing the AINMem deployment announcement

Draft the deployment announcement to post in Slack. The goal is a short text a person can read and paste as is. The announcement is written in the team's Slack language (Korean); take the wording of UI locations from the ko dictionary (`app/src/i18n/ko.ts`).

## 1. Find this deployment's range

The production image tag is `app-<7-char commit>`. The one running now is "this", the tag right before it is "previous".

```bash
docker ps --format '{{.Names}} {{.Image}} {{.Status}}' | grep ainmem_prod_app   # this deployment
docker images ainmem_prod --format '{{.Tag}} {{.CreatedAt}}' | head -5           # the previous tag
```

If the user names a range, use that. If the production container is not visible, do not guess — ask which range to write for.

```bash
git log --reverse --format='%h %ad %s' --date=short <previous>..<this>
```

For commits whose title leaves the feature unclear, check `git show --stat <commit>` and the body.

## 2. What goes in

- **Only new features or noticeable behaviour changes a user would see on screen.**
- Several commits for one feature (measurement notes, checks, follow-up fixes) collapse into one line.
- Leave out: commits that are only checks, docs or measurement records; internal refactors; internal permission/security fixes; small bug fixes users would not notice.
- Features that already shipped in a previous deployment are not repeated.

## 3. How to write it (fixed format)

- **One sentence per feature.** No sub-lists, detailed rules, numbers or implementation talk.
- Register: **"In <where>, through <what>, you can now <do what>."** (in Korean, the polite "you can now …" ending).
- **No emoji.** Not in the title, not in the lines.
- Name locations exactly as the user sees them (the "⋯" menu top right, the 'Move to trash' entry — use the ko dictionary strings).
- Put it in a single code block so it is easy to copy.

```
AINMem update notice (M/D)

- In the ⋯ menu at the top right of a page, through 'Move to trash', you can now delete a page.
- In page comments, through @, you can now mention the person you want.
- In the video block, you can now upload a video file directly.
```

Bad example (too detailed — do not write like this):

```
💬 Comment mentions
• In the comment box you can now type @ to mention a workspace member.
• People can also be found by part of a name or email, or by Korean initial consonants.
```

## 4. What to say outside the announcement

After the announcement body, if there is a **known limitation** the owner should know about that did not go into the announcement (for example an unresolved behaviour in a new feature that may draw questions), note it separately in a sentence or two. If there is none, write nothing.
