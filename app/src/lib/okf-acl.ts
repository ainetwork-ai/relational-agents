import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { okfAcl } from "@/lib/db/schema";
import { decodeId, isOkfId } from "@/lib/okf-store";

/**
 * OKF 경로 ACL — 파일 트리에는 원래 권한 개념이 없어서, 참여자 전용 콘텐츠
 * (관계 문서)를 파일로 두려면 이 레이어가 모든 읽기/쓰기 경로를 게이트한다.
 *
 * 규칙: 어떤 경로가 등록된 제한 경로 자신이거나 그 하위면, memberIds에 있는
 * 사용자만 접근할 수 있다. 등록되지 않은 경로는 기존대로 워크스페이스 공유.
 */

/** 제한 경로와 그 하위 여부. `a/b`는 `a/b`, `a/b/c.md`를 덮지만 `a/bb`는 아니다. */
function covers(restricted: string, target: string): boolean {
  return target === restricted || target.startsWith(`${restricted}/`);
}

/** 경로(또는 그 조상)를 참여자 전용으로 등록/갱신한다. 멱등. */
export async function setOkfAcl(
  path: string,
  roomId: string | null,
  memberIds: string[]
): Promise<void> {
  const unique = [...new Set(memberIds)];
  await db
    .insert(okfAcl)
    .values({ path, roomId, memberIds: unique, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: okfAcl.path,
      set: { roomId, memberIds: unique, updatedAt: new Date() },
    });
}

export async function clearOkfAcl(path: string): Promise<void> {
  await db.delete(okfAcl).where(eq(okfAcl.path, path));
}

export interface OkfGate {
  /** OKF 상대 경로를 이 사용자가 볼 수 있는가. */
  canRead(relPath: string): boolean;
  /** 페이지 id(OKF 인코딩 id 또는 UUID)를 볼 수 있는가. UUID는 항상 true
   *  (Postgres 페이지는 별도 restricted/pageMembers 경로가 처리한다). */
  canReadId(pageId: string): boolean;
}

/** 이 사용자의 게이트를 만든다 — 제한 목록을 한 번만 읽어 필터로 재사용. */
export async function okfGateFor(userId: string): Promise<OkfGate> {
  const rows = await db.select().from(okfAcl);
  const denied = rows.filter((r) => !(r.memberIds ?? []).includes(userId)).map((r) => r.path);
  const canRead = (relPath: string) => !denied.some((d) => covers(d, relPath));
  return {
    canRead,
    canReadId: (pageId: string) => (isOkfId(pageId) ? canRead(safeDecode(pageId)) : true),
  };
}

/** 단건 확인 (라우트에서 1회성으로 쓸 때). */
export async function canReadOkfPath(relPath: string, userId: string): Promise<boolean> {
  const gate = await okfGateFor(userId);
  return gate.canRead(relPath);
}

function safeDecode(id: string): string {
  try {
    return decodeId(id);
  } catch {
    return id;
  }
}
