/**
 * Users Database Queries
 *
 * Pure reads + API-key rotation are re-exported from cod-shared.
 * Writes that invoke the scope cache (createUser, updateUser, grantScope,
 * revokeScope) stay here because `clearScopeCache` is server-only.
 */

import { eq, and } from "drizzle-orm";
import { users, userScopes, accounts } from "@/db/schema";
import { clearScopeCache } from "@/rbac/permissions";
import { getDb } from "@/db";

import {
  getAllUsers,
  getUserById,
  rotateApiKey,
} from "../../../../cod-shared/queries/users";

export { getAllUsers, getUserById, rotateApiKey };

type Database = ReturnType<typeof getDb>;

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

  type BatchStatement = Parameters<Database["batch"]>[0][number];

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

  if (userData.role !== "admin" && initialScopes.length > 0) {
    statements.push(
      db.insert(userScopes).values(
        initialScopes.map(scope => ({
          id: crypto.randomUUID(),
          userId: userData.id,
          scope,
          grantedBy,
          grantedAt: nowIso,
        }))
      )
    );
  }

  await db.batch(statements as [BatchStatement, ...BatchStatement[]]);

  // Return constructed user (same shape as getUserById, no extra queries)
  return {
    id: userData.id,
    email: userData.email,
    name: userData.name,
    role: userData.role,
    status: userData.status,
    scopes: userData.role === "admin" ? ["*"] : initialScopes,
    emailVerified: true,
    language: userData.language ?? "en",
    apiKey: userData.apiKey,
    createdAt: nowDate,  // Date object, not ISO string
    updatedAt: nowDate,  // Date object, not ISO string
  };
}

/**
 * Update user information
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
  await db
    .update(users)
    .set({
      ...updates,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));

  if (updates.role) {
    clearScopeCache(userId);
  }

  return getUserById(db, userId);
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

  clearScopeCache(userId);
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

  clearScopeCache(userId);
  return getUserById(db, userId);
}
