import { test, expect } from "@playwright/test";
import {
  spawnPerson,
  inviteAndJoin,
  openRoom,
  bornRelationship,
  postMessage,
  signDissolve,
  waitForOkfDoc,
  readOkfDump,
} from "./relation-helpers";

/**
 * Demo scene 7 — Epilogue: the relationship ends, the agent remains. Closing
 * mirrors opening — the SAME two wallets sign an EIP-712 RelationDissolve; only
 * when both have signed is dissolvedAt stamped. The record and its memories are
 * NOT erased: what two people made together outlives the relationship.
 */
test.describe("DEMO-07 Epilogue — dissolve, record remains", () => {
  test("both sign RelationDissolve → dissolved, but the memory survives", async ({
    browser,
    baseURL,
  }) => {
    const chanho = await spawnPerson(browser, baseURL, "Chanho");
    const hannah = await spawnPerson(browser, baseURL, "Hannah Brooks");
    try {
      await inviteAndJoin(chanho.ctx, hannah.ctx);
      const room = await openRoom(chanho.ctx, hannah.id);
      await bornRelationship(chanho, hannah, room.id);

      // lay down a memory so we can prove it survives dissolution
      const mark = `KEEPSAKE_${Date.now()}`;
      await postMessage(chanho.ctx, room.id, `our Lisbon evening ${mark}`);
      const before = await waitForOkfDoc(new RegExp(mark));

      // status: agent alive, not yet dissolved, dissolve contract available
      const status0 = await (await chanho.ctx.get(`/api/dm/rooms/${room.id}/dissolve`)).json();
      expect(status0.consentAt).not.toBeNull();
      expect(status0.dissolvedAt).toBeNull();
      expect(status0.canDissolve).toBeTruthy();
      expect(status0.required).toBe(2);

      // one signature does not close anything
      const one = await signDissolve(chanho, room.id);
      expect(one.dissolvedAt).toBeNull();

      // the second closes it
      const two = await signDissolve(hannah, room.id);
      expect(two.dissolvedAt).not.toBeNull();

      const status1 = await (await chanho.ctx.get(`/api/dm/rooms/${room.id}/dissolve`)).json();
      expect(status1.dissolvedAt).not.toBeNull();

      // the agent's record outlives the relationship — the memory is still there
      const after = readOkfDump().find((d) => d.file === before.file);
      expect(after, "the relationship doc still exists after dissolution").toBeTruthy();
      expect(after!.content).toContain(mark);
    } finally {
      await Promise.all([chanho, hannah].map((p) => p.context.close()));
    }
  });
});
