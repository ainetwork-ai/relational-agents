import { test, expect } from "@playwright/test";
import {
  spawnPerson,
  inviteAndJoin,
  openRoom,
  signConsent,
  bornRelationship,
  listMessages,
  myAgents,
} from "./relation-helpers";

/**
 * Demo scene 4 — Mutual consent → two relationships are born. Both members sign
 * the EIP-712 RelationConsent; on the SECOND signature consentAt is stamped, the
 * agent is provisioned and greets the room. Done for BOTH Chanho❤️Hannah and
 * Chanho❤️Ava, exactly as the demo shows.
 */
test.describe("DEMO-04 Consent — two relationships born on camera", () => {
  test("both sign → agent born, greets, and appears in Agents", async ({ browser, baseURL }) => {
    const chanho = await spawnPerson(browser, baseURL, "Chanho");
    const hannah = await spawnPerson(browser, baseURL, "Hannah Brooks");
    const ava = await spawnPerson(browser, baseURL, "Ava Thorne");
    try {
      await inviteAndJoin(chanho.ctx, hannah.ctx);
      await inviteAndJoin(chanho.ctx, ava.ctx);

      // ---- Chanho ❤️ Hannah ----
      const room1 = await openRoom(chanho.ctx, hannah.id);
      expect(room1.name).toContain("❤️");

      // all-wallet room → no instant consent; the contract must be signed
      const before = await (await chanho.ctx.get(`/api/dm/rooms/${room1.id}/consent`)).json();
      expect(before.consentAt).toBeNull();
      expect(before.required).toBe(2);

      // first signature alone does NOT birth the agent
      const afterOne = await signConsent(chanho, room1.id);
      expect(afterOne.consentAt).toBeNull();

      // second signature completes it
      const done1 = await signConsent(hannah, room1.id);
      expect(done1.consentAt).not.toBeNull();

      // the agent greeted the room the moment it was born
      const msgs1 = await listMessages(chanho.ctx, room1.id);
      const greeting = msgs1.find(
        (m) => m.authorId !== chanho.id && m.authorId !== hannah.id && /relationship agent/i.test(m.text)
      );
      expect(greeting, "agent greeting posted on birth").toBeTruthy();

      // ---- Chanho ❤️ Ava ---- (same flow, second relationship)
      const room2 = await openRoom(chanho.ctx, ava.id);
      const done2 = await bornRelationship(chanho, ava, room2.id);
      expect(done2.consentAt).not.toBeNull();

      // both agents now live in Chanho's Agents section, one per relationship
      const agents = await myAgents(chanho.ctx);
      const roomIds = new Set(agents.map((a) => a.roomId));
      expect(roomIds.has(room1.id)).toBeTruthy();
      expect(roomIds.has(room2.id)).toBeTruthy();
      expect(agents.length).toBeGreaterThanOrEqual(2);
    } finally {
      await Promise.all([chanho, hannah, ava].map((p) => p.context.close()));
    }
  });
});
