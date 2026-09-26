/**
 * Glyphs and token marks for the Treasury page: the ETH diamond and the Base
 * disc beside the agent's address, and the ETH / USDC / WETH token icons.
 * Chain and Uniswap badges are components/chain/chain-badge.tsx's, shared with
 * every other surface.
 */

import type { Token } from "./wallet-model";
import styles from "./treasury-room.module.css";

export function EthGlyph({ size = 12 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden className={styles.glyph}>
      <path d="M12 2 5.5 12.3 12 16.2l6.5-3.9zM12 17.6l-6.5-3.9L12 22l6.5-8.3z" />
    </svg>
  );
}

export function BaseGlyph({ size = 12 }: { size?: number }) {
  return <i className={styles.baseGlyph} style={{ width: size, height: size }} aria-hidden />;
}

export function TokenIcon({ token, size = 36 }: { token: Token; size?: number }) {
  const cls = token === "USDC" ? styles.tokenUsdc : token === "WETH" ? styles.tokenWeth : styles.tokenEth;
  return (
    <span className={`${styles.tokenIcon} ${cls}`} style={{ width: size, height: size, fontSize: Math.round(size * 0.46) }} aria-hidden>
      {token === "USDC" ? "$" : <EthGlyph size={Math.round(size * 0.5)} />}
    </span>
  );
}

/** A token in a white pill, as the swap boxes name what goes in and out. */
export function TokenPill({ token }: { token: Token }) {
  return (
    <span className={styles.tokenPill}>
      <TokenIcon token={token} size={26} />
      {token}
    </span>
  );
}
