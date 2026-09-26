// Can we attach to the original (Notion)? — run this first, before any parity work.
//
// The bar for Projects page work is not our judgement but **zero difference from the original**.
// So when the original cannot be seen, that is not "carry on" but **stop work**. This script
// turns that verdict into an exit code instead of a human eyeball.
//
//   node e2e/golden.check.mjs        # 0 = can measure, 1 = must stop
//
// What it checks: (1) whether the reverse tunnel on server port 9333 is alive, (2) whether a
// Notion page tab exists, (3) whether that tab **responds to JS execution**. (3) matters — it has
// really happened that a tab looked alive while its renderer was frozen and Runtime.evaluate never returned.
//
// Read-only: it only evaluates 1+1 and changes nothing.

const HOST = process.env.CDP ?? "http://127.0.0.1:9333";
const MAC_TUNNEL = "ssh -R 9333:127.0.0.1:9333 comcom@192.168.1.194";
const MAC_CHROME =
  '"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=9333 --user-data-dir=/tmp/cdp4';

const die = (...lines) => {
  console.error("\n  ┌─ Cannot attach to the original (Notion) — stop parity work ─");
  for (const l of lines) console.error(`  │ ${l}`);
  console.error("  │");
  console.error("  │ On the Mac (each in its own terminal, left running):");
  console.error(`  │   ${MAC_CHROME}`);
  console.error(`  │   ${MAC_TUNNEL}`);
  console.error("  │");
  console.error("  │ Full procedure: docs/notion-golden-set.md");
  console.error("  └──────────────────────────────────────────────────────────\n");
  process.exit(1);
};

const list = await fetch(`${HOST}/json/list`, { signal: AbortSignal.timeout(5000) })
  .then((r) => r.json())
  .catch(() => null);
if (!list) die(`nobody is at ${HOST} (the reverse tunnel is down or Chrome is closed).`);

const tabs = list.filter((t) => t.type === "page" && t.url.includes("app.notion.com/p/"));
if (!tabs.length)
  die("the tunnel is alive but there is no Notion page tab.", "open the Projects page in that Chrome.");

/** Whether the tab really runs JS — a frozen renderer is caught here */
const responds = async (t) => {
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  const ok = await new Promise((res) => {
    const to = setTimeout(() => res(false), 6000);
    ws.addEventListener("open", () => {
      ws.addEventListener("message", (e) => {
        if (JSON.parse(e.data).id === 1) {
          clearTimeout(to);
          res(true);
        }
      });
      ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: "1+1", returnByValue: true } }));
    });
    ws.addEventListener("error", () => {
      clearTimeout(to);
      res(false);
    });
  });
  ws.close();
  return ok;
};

const alive = [];
for (const t of tabs) {
  const ok = await responds(t);
  console.log(`${ok ? "✓" : "✗ frozen"}  ${t.id.slice(0, 8)}  ${t.title.slice(0, 50)}`);
  if (ok) alive.push(t);
}

if (!alive.length)
  die(
    "there are Notion tabs but none of them respond (renderer frozen).",
    "reload that tab, or open it in a new tab:",
    `curl -X PUT '${HOST}/json/new?' + encodeURIComponent(<Projects URL>)`,
  );

console.log(`\nThe original can be measured — ${alive.length} responding Notion tab(s).`);
process.exit(0);
