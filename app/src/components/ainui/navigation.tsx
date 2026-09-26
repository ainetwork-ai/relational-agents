"use client";
import type { LucideIcon } from "lucide-react";
import { AinuiButton } from "./surface";
import styles from "./navigation.module.css";

/** Compact host styling for AIN-UI actions inside navigation, not form cards. */
export function AinuiNavItem({ label, icon: Icon, onClick, active = false, status, size = "row", testId, title }: {
  label: string; icon: LucideIcon; onClick: () => void | Promise<unknown>; active?: boolean;
  status?: "online" | "offline" | "synced" | "syncing" | "pending" | "failed";
  size?: "row" | "small" | "icon"; testId?: string; title?: string;
}) {
  return <div className={styles.item} data-active={active} data-size={size} title={title ?? label} aria-current={active ? "page" : undefined}>
    <AinuiButton label={label} onClick={onClick} testId={testId} />
    <Icon size={14} className={styles.icon} aria-hidden />
    {status && <span className={styles.status} data-status={status} aria-hidden />}
  </div>;
}
