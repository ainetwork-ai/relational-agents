// 원본(노션)에 붙을 수 있나? — parity 작업 전에 제일 먼저 돌린다.
//
// Projects 페이지 작업의 기준은 우리 판단이 아니라 **원본과의 차이 0**이다.
// 그래서 원본이 안 보이면 그건 "그냥 진행"이 아니라 **작업 중지**다. 이 스크립트는
// 그 판정을 사람 눈이 아니라 종료코드로 만든다.
//
//   node e2e/golden.check.mjs        # 0 = 잴 수 있음, 1 = 멈춰야 함
//
// 무엇을 보나: (1) 서버 9333에 역터널이 살아있는지, (2) 노션 페이지 탭이 있는지,
// (3) 그 탭이 **JS 실행에 응답**하는지. (3)이 중요하다 — 탭이 살아있는 것처럼
// 보이면서 렌더러가 멈춰 Runtime.evaluate 가 영영 안 돌아오는 일이 실제로 있었다.
//
// 읽기 전용: 1+1 을 평가할 뿐 아무것도 바꾸지 않는다.

const HOST = process.env.CDP ?? "http://127.0.0.1:9333";
const MAC_TUNNEL = "ssh -R 9333:127.0.0.1:9333 comcom@192.168.1.194";
const MAC_CHROME =
  '"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=9333 --user-data-dir=/tmp/cdp4';

const die = (...lines) => {
  console.error("\n  ┌─ 원본(노션)에 붙을 수 없습니다 — parity 작업 중지 ────────");
  for (const l of lines) console.error(`  │ ${l}`);
  console.error("  │");
  console.error("  │ 맥에서(각각 다른 터미널, 켜둔 채로):");
  console.error(`  │   ${MAC_CHROME}`);
  console.error(`  │   ${MAC_TUNNEL}`);
  console.error("  │");
  console.error("  │ 자세한 절차: docs/notion-golden-set.md");
  console.error("  └──────────────────────────────────────────────────────────\n");
  process.exit(1);
};

const list = await fetch(`${HOST}/json/list`, { signal: AbortSignal.timeout(5000) })
  .then((r) => r.json())
  .catch(() => null);
if (!list) die(`${HOST} 에 아무도 없습니다 (역터널이 내려갔거나 크롬이 꺼져 있습니다).`);

const tabs = list.filter((t) => t.type === "page" && t.url.includes("app.notion.com/p/"));
if (!tabs.length)
  die("터널은 살아있는데 노션 페이지 탭이 없습니다.", "그 크롬에서 Projects 페이지를 열어주세요.");

/** 탭이 정말 JS를 돌리는지 — 멈춘 렌더러는 여기서 걸린다 */
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
  console.log(`${ok ? "✓" : "✗ 멈춤"}  ${t.id.slice(0, 8)}  ${t.title.slice(0, 50)}`);
  if (ok) alive.push(t);
}

if (!alive.length)
  die(
    "노션 탭은 있는데 전부 응답하지 않습니다 (렌더러 멈춤).",
    "그 탭을 새로고침하거나, 새 탭으로 여세요:",
    `curl -X PUT '${HOST}/json/new?' + encodeURIComponent(<Projects URL>)`,
  );

console.log(`\n원본을 잴 수 있습니다 — 응답하는 노션 탭 ${alive.length}개.`);
process.exit(0);
