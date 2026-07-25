import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import {
  spawnPerson,
  inviteAndJoin,
  openRoom,
  bornRelationship,
  listMessages,
  waitForOkfDoc,
} from "./relation-helpers";

/**
 * Demo scene 5 — It remembers: in Chanho ❤️ Hannah, drop the Lisbon egg-tart
 * photo into the chat with a caption. The agent files it into THIS
 * relationship's record — the Timeline gains the line and the photo — and reacts
 * in the room. Reproduced deterministically via the fakeEdits pipeline.
 */
const EGG_TART = path.resolve(__dirname, "../../docs/img/egg-tart.jpg");

test.describe("DEMO-05 It remembers — upload → memory", () => {
  test("photo + caption become a Timeline entry with the image", async ({ browser, baseURL }) => {
    const chanho = await spawnPerson(browser, baseURL, "Chanho");
    const hannah = await spawnPerson(browser, baseURL, "Hannah Brooks");
    try {
      await inviteAndJoin(chanho.ctx, hannah.ctx);
      const room = await openRoom(chanho.ctx, hannah.id);
      const born = await bornRelationship(chanho, hannah, room.id);
      expect(born.consentAt).not.toBeNull();

      // upload the egg-tart photo (real image bytes through the real endpoint)
      const up = await chanho.ctx.post("/api/upload", {
        multipart: {
          file: { name: "egg-tart.jpg", mimeType: "image/jpeg", buffer: fs.readFileSync(EGG_TART) },
        },
      });
      expect(up.ok(), `upload: ${up.status()}`).toBeTruthy();
      const { url } = await up.json();
      expect(url).toMatch(/^\/uploads\/[\w.-]+\.jpg$/);

      // send it into the agent chat with a caption unique to this run. The token
      // must be unique so waitForOkfDoc keys on the AGENT'S write — not on the
      // seeded demo.md (which itself contains "Pastel de Nata" under the OKF root).
      const token = `NATAS_${Date.now()}`;
      const caption = `we had nice egg tart (Pastel de Nata) in Lisbon today ${token} 🥧`;
      const res = await chanho.ctx.post(`/api/dm/rooms/${room.id}/messages`, {
        data: { text: caption, attachments: [{ name: "egg-tart.jpg", url }] },
      });
      expect(res.ok(), `message: ${res.status()}`).toBeTruthy();
      const { autoRun } = await res.json();
      // threshold=1 for DM rooms → the agent recorded synchronously on send
      expect(autoRun?.edits, "agent wrote to the record").toBeGreaterThan(0);

      // the memory landed in the relationship doc: caption + the photo markdown
      const doc = await waitForOkfDoc(new RegExp(token));
      expect(doc.content).toContain(caption);
      expect(doc.content).toMatch(/pastel de nata/i); // the egg tart, in the record
      expect(doc.content).toContain(url); // the image is embedded, not just the text

      // and the agent reacted in the room so the memory is visible
      const msgs = await listMessages(chanho.ctx, room.id);
      const ack = msgs.find((m) => /saved this moment/i.test(m.text));
      expect(ack, "agent acknowledged the photo").toBeTruthy();
    } finally {
      await Promise.all([chanho, hannah].map((p) => p.context.close()));
    }
  });
});
