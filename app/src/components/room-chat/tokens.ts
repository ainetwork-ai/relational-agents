/** Notion colour tokens for the room chat, as full Tailwind class strings (the
 *  scanner only sees literal class names). Light values are Notion's measured
 *  ones; the dark: halves keep the chat legible under the app's .dark class. */
export const TEXT = "text-[#171717] dark:text-neutral-100";
export const TEXT_BODY = "text-[#37352F] dark:text-neutral-200";
export const TEXT_2 = "text-[#7D7A75] dark:text-neutral-400";
export const TEXT_3 = "text-[#A19E99] dark:text-neutral-500";
export const BORDER = "border-[rgba(55,53,47,0.09)] dark:border-white/10";
export const BORDER_STRONG = "border-[rgba(55,53,47,0.16)] dark:border-white/15";
export const ROW_HOVER = "hover:bg-[rgba(55,53,47,0.03)] dark:hover:bg-white/[0.03]";
export const PRESSED_BG = "bg-[rgba(55,53,47,0.06)] dark:bg-white/[0.06]";
export const BUTTON_HOVER = "hover:bg-[rgba(55,53,47,0.06)] dark:hover:bg-white/[0.06]";
export const SURFACE = "bg-white dark:bg-neutral-900";
/** Notion's popover shadow (menus, the action bar, the jump pill). */
export const POP_SHADOW =
  "shadow-[0_0_0_1px_rgba(15,15,15,0.05),0_3px_6px_rgba(15,15,15,0.1),0_9px_24px_rgba(15,15,15,0.2)]";
export const ACCENT_BG = "bg-[#2383E2]";
export const GRAY_CHIP =
  "bg-[rgba(28,19,1,0.11)] text-[rgb(73,72,70)] dark:bg-white/10 dark:text-neutral-300";
export const YELLOW_CHIP =
  "bg-[rgba(209,156,0,0.16)] text-[rgb(106,66,34)] dark:bg-amber-500/20 dark:text-amber-200";
export const AGENT_AVATAR = "bg-[#F1F1EF] text-[#37352F] dark:bg-neutral-800 dark:text-neutral-200";
/** Notion's orange tag — the "Only the agent" chip on a posted private message. */
export const ORANGE_CHIP =
  "bg-[rgba(196,88,0,0.204)] text-[rgb(106,66,34)] dark:bg-orange-500/20 dark:text-orange-200";
/** An @mention inside message text. */
export const MENTION =
  "rounded-[3px] bg-[rgba(0,118,217,0.1)] px-[3px] font-medium text-[rgb(38,74,114)] dark:bg-blue-500/15 dark:text-blue-300";

/** Initial-avatar tints for people without a photo — Notion's tag colours, so
 *  authors in the flat stream are told apart at a glance. */
export const AVATAR_TINTS = [
  "bg-[rgba(28,19,1,0.11)] text-[rgb(73,72,70)] dark:bg-white/10 dark:text-neutral-300",
  "bg-[rgba(196,88,0,0.204)] text-[rgb(106,66,34)] dark:bg-orange-500/20 dark:text-orange-200",
  "bg-[rgba(0,118,217,0.204)] text-[rgb(38,74,114)] dark:bg-blue-500/20 dark:text-blue-200",
  "bg-[rgba(0,96,38,0.157)] text-[rgb(42,83,60)] dark:bg-green-500/20 dark:text-green-200",
  "bg-[rgba(206,24,0,0.165)] text-[rgb(109,53,49)] dark:bg-red-500/20 dark:text-red-200",
] as const;

/** A stable tint per user id: the same person gets the same colour everywhere. */
export function tintFor(userId: string): (typeof AVATAR_TINTS)[number] {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  return AVATAR_TINTS[hash % AVATAR_TINTS.length];
}
