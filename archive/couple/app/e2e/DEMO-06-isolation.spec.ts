import { test, expect } from "@playwright/test";
import {
  spawnPerson,
  inviteAndJoin,
  openRoom,
  bornRelationship,
  postMessage,
  waitForOkfDoc,
  readOkfDump,
} from "./relation-helpers";

/**
 * Demo scene 6 — Finale: Ava asks about egg tarts over a video call, and her
 * relationship's agent has NO record — "Not in this relationship." The egg tart
 * lives with Hannah and ONLY there. This proves per-relationship memory
 * isolation: two agents born the same way, one remembers, the other cannot.
 */
test.describe("DEMO-06 Isolation — the egg tart lives with Hannah only", () => {
  test("Hannah's record holds it; Ava's never does", async ({ browser, baseURL }) => {
    const chanho = await spawnPerson(browser, baseURL, "Chanho");
    const hannah = await spawnPerson(browser, baseURL, "Hannah Brooks");
    const ava = await spawnPerson(browser, baseURL, "Ava Thorne");
    try {
      await inviteAndJoin(chanho.ctx, hannah.ctx);
      await inviteAndJoin(chanho.ctx, ava.ctx);

      const roomH = await openRoom(chanho.ctx, hannah.id);
      await bornRelationship(chanho, hannah, roomH.id);
      const roomA = await openRoom(chanho.ctx, ava.id);
      await bornRelationship(chanho, ava, roomA.id);

      // unique markers so each relationship's doc is identifiable on disk
      const stamp = Date.now();
      const hannahMark = `HANNAHONLY_${stamp}`;
      const avaMark = `AVAONLY_${stamp}`;

      // Hannah's relationship records the egg tart; Ava's records only small talk
      await postMessage(chanho.ctx, roomH.id, `midnight Pastel de Nata in Lisbon ${hannahMark} 🥧`);
      await postMessage(chanho.ctx, roomA.id, `great to catch up today ${avaMark}`);

      // wait until both agents have written
      const hDoc = await waitForOkfDoc(new RegExp(hannahMark));
      const aDoc = await waitForOkfDoc(new RegExp(avaMark));

      // Hannah's record has the egg tart
      expect(hDoc.content).toMatch(/nata|egg tart/i);

      // Ava's record does NOT — "Not in this relationship"
      const avaDocs = readOkfDump().filter((d) => d.content.includes(avaMark));
      expect(avaDocs.length).toBeGreaterThan(0);
      for (const d of avaDocs) {
        expect(d.content, `${d.file} must not leak the egg tart`).not.toMatch(/nata|egg tart/i);
      }

      // memories do not co-mingle: Hannah's doc and Ava's doc are separate files
      expect(hDoc.file).not.toBe(aDoc.file);
      expect(hDoc.content).not.toContain(avaMark);
      expect(aDoc.content).not.toContain(hannahMark);
    } finally {
      await Promise.all([chanho, hannah, ava].map((p) => p.context.close()));
    }
  });
});
