/**
 * Users Database Queries
 *
 * Pure reads + API-key rotation are re-exported from cod-shared; the writes
 * live here. Every request reads the caller's role, status and permissions
 * afresh, so a change applies from their next request.
 */

import { eq, and, ne, or, sql } from "drizzle-orm";
import { users, userScopes, accounts } from "@/db/schema";
import { getDb } from "@/db";

import {
  getAllUsers,
  getUserById,
  rotateApiKey,
} from "../../../../cod-shared/queries/users";

export { getAllUsers, getUserById, rotateApiKey };

type Database = ReturnType<typeof getDb>;
type BatchStatement = Parameters<Database["batch"]>[0][number];

/** Five values a row; D1 binds at most 100 per statement. */
const SCOPE_ROWS_PER_INSERT = 19;

/** The inserts that give a member these permissions, each under D1's limit. */
function insertScopes(db: Database, rows: ReadonlyArray<typeof userScopes.$inferInsert>): BatchStatement[] {
  const statements: BatchStatement[] = [];
  for (let start = 0; start < rows.length; start += SCOPE_ROWS_PER_INSERT) {
    statements.push(db.insert(userScopes).values(rows.slice(start, start + SCOPE_ROWS_PER_INSERT)));
  }
  return statements;
}

/**
 * Create new user with credential account + initial scope assignment.
 * Uses db.batch() to reduce round-trips: 3 sequential inserts → 1 batched
 * round-trip. Returns the constructed user object instead of re-querying.
 */
export async function createUser(
  db: Database,
  userData: {
    id: string;
    email: string;
    name: string;
    role: "admin" | "staff";
    status: "active" | "inactive";
    apiKey: string;
    passwordHash: string;
    language?: "ar" | "en";
  },
  initialScopes: string[],
  grantedBy: string,
) {
  const nowDate = new Date();
  const nowIso = nowDate.toISOString();

  // Batch all inserts together (1 round-trip instead of 3)
  const statements: BatchStatement[] = [
    db.insert(users).values({
      id: userData.id,
      name: userData.name,
      email: userData.email,
      emailVerified: true,
      role: userData.role,
      status: userData.status,
      apiKey: userData.apiKey,
      language: userData.language ?? "en",
      createdAt: nowDate,
      updatedAt: nowDate,
    }),
    // Credential account for better-auth password sign-in. 1.7 lookup semantics
    // (see migration 0010 + scripts/seed-admin.mjs): issuer = 'local:credential'
    // and account_id = USER ID — not the email. Wrong shape = every sign-in 401s.
    db.insert(accounts).values({
      id: crypto.randomUUID(),
      userId: userData.id,
      accountId: userData.id,
      providerId: "credential",
      issuer: "local:credential",
      password: userData.passwordHash,
      createdAt: nowDate,
      updatedAt: nowDate,
    }),
  ];

  const scopes = userData.role === "admin" ? [] : [...new Set(initialScopes)];
  statements.push(...insertScopes(db, scopes.map((scope) => ({ id: crypto.randomUUID(), userId: userData.id, scope, grantedBy, grantedAt: nowIso }))));

  await db.batch(statements as [BatchStatement, ...BatchStatement[]]);

  // Return constructed user (same shape as getUserById, no extra queries)
  return {
    id: userData.id,
    email: userData.email,
    name: userData.name,
    role: userData.role,
    status: userData.status,
    scopes: userData.role === "admin" ? ["*"] : scopes,
    emailVerified: true,
    language: userData.language ?? "en",
    apiKey: userData.apiKey,
    createdAt: nowDate,  // Date object, not ISO string
    updatedAt: nowDate,  // Date object, not ISO string
  };
}

/**
 * Changes a member. A change that would leave the store without an active
 * admin changes nothing and returns null; it is decided in the same
 * statement as the write, so two admins turning each other off at once
 * cannot both succeed.
 */
export async function updateUser(
  db: Database,
  userId: string,
  updates: {
    email?: string;
    name?: string;
    role?: "admin" | "staff";
    status?: "active" | "inactive";
  }
) {
  const takesAdminAway = updates.role === "staff" || updates.status === "inactive";
  const anotherAdmin = sql`exists (select 1 from users o where o.id <> ${userId} and o.role = 'admin' and o.status = 'active')`;
  const changed = await db
    .update(users)
    .set({ ...updates, updatedAt: new Date() })
    .where(takesAdminAway ? and(eq(users.id, userId), or(ne(users.role, "admin"), ne(users.status, "active"), anotherAdmin)) : eq(users.id, userId))
    .returning({ id: users.id });
  return changed.length > 0 ? getUserById(db, userId) : null;
}

/**
 * Gives a member exactly these permissions, in one transaction: the ones
 * not listed are taken away, the ones they kept keep who granted them and
 * when. Says which were granted and which revoked.
 */
export async function setScopes(db: Database, userId: string, scopes: readonly string[], grantedBy: string) {
  const wanted = [...new Set(scopes)];
  const current = await db
    .select({ scope: userScopes.scope, grantedBy: userScopes.grantedBy, grantedAt: userScopes.grantedAt })
    .from(userScopes)
    .where(eq(userScopes.userId, userId));
  const held = new Map(current.map((row) => [row.scope, row]));
  const granted = wanted.filter((scope) => !held.has(scope));
  const revoked = [...held.keys()].filter((scope) => !wanted.includes(scope));
  const now = new Date().toISOString();
  const rows = wanted.map((scope) => ({ id: crypto.randomUUID(), userId, scope, grantedBy: held.get(scope)?.grantedBy ?? grantedBy, grantedAt: held.get(scope)?.grantedAt ?? now }));
  await db.batch([db.delete(userScopes).where(eq(userScopes.userId, userId)), ...insertScopes(db, rows)] as [BatchStatement, ...BatchStatement[]]);
  return { granted, revoked };
}

/**
 * Grant scope to user
 */
export async function grantScope(
  db: Database,
  userId: string,
  scope: string,
  grantedBy: string
) {
  const existing = await db
    .select()
    .from(userScopes)
    .where(and(eq(userScopes.userId, userId), eq(userScopes.scope, scope)))
    .get();

  if (existing) {
    throw new Error("Scope already granted to user");
  }

  await db.insert(userScopes).values({
    id: crypto.randomUUID(),
    userId,
    scope,
    grantedBy,
    grantedAt: new Date(Date.now()).toISOString(),
  });

  return getUserById(db, userId);
}

/**
 * Revoke scope from user
 */
export async function revokeScope(
  db: Database,
  userId: string,
  scope: string
) {
  await db
    .delete(userScopes)
    .where(and(eq(userScopes.userId, userId), eq(userScopes.scope, scope)));

  return getUserById(db, userId);
}
