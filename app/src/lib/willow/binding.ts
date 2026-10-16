import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * ainmem's word that a browser's device key belongs to one ainmem user
 * (docs/willow-ainmem-plan.md Task 5). Handed out when ainmem gets the key its
 * aindrive certificate; a save that carries signed transactions must carry the
 * binding for the session's own user, so a key bound to one person cannot sign
 * in another person's session.
 */
function mac(userId: string, deviceKeyHex: string): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required for device bindings");
  return createHmac("sha256", `ainmem-device-binding:${secret}`).update(`${userId}:${deviceKeyHex}`).digest();
}

export const deviceBinding = (userId: string, deviceKeyHex: string): string => mac(userId, deviceKeyHex).toString("base64url");

export function bindingValid(userId: string, deviceKeyHex: string, binding: string): boolean {
  if (typeof binding !== "string" || !/^[0-9a-f]{64}$/.test(deviceKeyHex)) return false;
  const got = Buffer.from(binding, "base64url");
  const want = mac(userId, deviceKeyHex);
  return got.length === want.length && timingSafeEqual(got, want);
}
