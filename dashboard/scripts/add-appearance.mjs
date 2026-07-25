// Concretize each persona with a distinct physical appearance + photo setting,
// written into the doc YAML as `appearance:` (base = EN persona). Hand-authored
// as a diversity matrix — ethnicity, hair, face, style, expression and scene
// are all deliberately non-overlapping so generated portraits can't converge.
//
//   MEMORY_BASE_URL=http://localhost:36625 node scripts/add-appearance.mjs

const BASE_URL = (process.env.MEMORY_BASE_URL || "http://localhost:36625").replace(/\/$/, "");
const INDEX_TITLE = "Relationship Records";

const APPEARANCE = {
  "Maya Sterling":
    "British woman, long wavy auburn-red hair loosely braided over one shoulder, green eyes, pale skin with light freckles, " +
    "mustard-yellow cardigan over a vintage band tee, silver rings and a faint ink smudge on her fingers, soft dreamy smile; " +
    "photographed in her cluttered art studio, natural window light",
  "Hannah Brooks":
    "athletic tanned woman, sun-bleached dark-blonde hair in a tight practical low ponytail, grey-blue eyes, sharp jawline, " +
    "no makeup, navy windbreaker, arms crossed, deadpan almost-smile with one raised eyebrow; " +
    "photographed on a harbor dock, overcast sea light",
  "Sophie Miller":
    "Black British woman, voluminous dark coily hair, warm brown eyes, deep glowing skin tone, bold coral lipstick, dimples, " +
    "chunky gold hoop earrings, bright orange blazer, laughing openly mid-gesture; " +
    "photographed in a trendy café, warm bokeh lights",
  "Lily Harper":
    "petite East Asian American woman, jet-black sleek high ponytail with wispy bangs, dark sparkling eyes, dewy skin, " +
    "white cropped hoodie and tiny gold studs, bright playful grin; " +
    "photographed in a bright modern gym lobby, clean daylight",
  "Claire Hudson":
    "elegant woman in her early thirties, sleek chin-length platinum-blonde bob, ice-blue eyes, high cheekbones, minimal makeup, " +
    "crisp white shirt with a thin gold necklace, composed confident half-smile; " +
    "photographed in a minimalist office, cool morning light",
  "Ava Thorne":
    "South Asian woman, long straight dark-brown hair with a middle part, calm hazel eyes, warm brown skin, a small nose stud, " +
    "sage-green linen shirt and mala bead bracelet, serene closed-lip smile; " +
    "photographed in a plant-filled yoga studio, soft warm light",
  "Zoe Harrison":
    "curvy woman, strawberry-blonde messy bun with escaping strands, heavy freckles across her nose and cheeks, hazel eyes, rosy cheeks, " +
    "cream apron over a gingham shirt with a dab of flour on one cheek, warm hearty laugh; " +
    "photographed in a cozy home kitchen, golden tungsten light",
  "Isla Montgomery":
    "pale Scottish woman, straight jet-black hair with a blunt fringe, sharp grey eyes behind thin round gold-rimmed glasses, " +
    "angular features, charcoal turtleneck under a tweed blazer (dark academia), subtle knowing smirk; " +
    "photographed in an old library between wooden shelves, moody window light",
  "Mia Collins":
    "Latina woman, big voluminous dark-chocolate curls past her shoulders, expressive dark-brown eyes with dramatic lashes, " +
    "red lipstick, statement earrings, ruby-red wrap top, caught in a theatrical mid-laugh; " +
    "photographed in a theater lobby, warm marquee glow",
  "Riley Vance":
    "tomboyish woman, short copper pixie cut, grey-green eyes, light freckles, " +
    "denim jacket covered in enamel pins over a striped tee, leaning slightly forward with a mischievous competitive grin; " +
    "photographed in a board-game café, shelves of games behind her",
};

let cookie = null;
async function login() {
  const res = await fetch(`${BASE_URL}/api/auth/demo-login`, { method: "POST" });
  cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  if (!res.ok) throw new Error(`login: HTTP ${res.status}`);
}
async function api(method, path, body) {
  if (!cookie) await login();
  const opts = { method, headers: { cookie, "content-type": "application/json" } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  let res = await fetch(BASE_URL + path, opts);
  if (res.status === 401) {
    await login();
    opts.headers.cookie = cookie;
    res = await fetch(BASE_URL + path, opts);
  }
  if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status}`);
  return res.json();
}
const text = (b) => (typeof b.content?.text === "string" ? b.content.text : "");

const { pages } = await api("GET", "/api/pages");
const index = pages.find((p) => p.title === INDEX_TITLE && !p.isArchived);
const kids = pages.filter((p) => p.parentPageId === index.id && !p.isArchived);
for (const p of kids) {
  const { blocks } = await api("GET", `/api/pages/${p.id}/blocks`);
  const code = blocks.find((b) => b.type === "code");
  const yaml = text(code);
  const name = yaml.match(/^name:\s*(.+)$/m)?.[1]?.trim();
  const spec = APPEARANCE[name];
  if (!spec) {
    console.log(`? ${p.title} — no appearance spec for "${name}"`);
    continue;
  }
  const cleaned = yaml
    .split("\n")
    .filter((l) => !/^appearance:/.test(l))
    .join("\n")
    .trimEnd();
  await api("PUT", `/api/pages/${p.id}/blocks`, {
    blocks: [{ id: code.id, type: "code", content: { text: `${cleaned}\nappearance: ${spec}\n` }, position: code.position }],
  });
  console.log(`✓ ${name}`);
}
console.log("done");
