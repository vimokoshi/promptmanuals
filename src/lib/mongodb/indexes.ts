/**
 * MongoDB index definitions.
 *
 * Each index mirrors the `@@index` declarations from the Prisma schema
 * as equivalent MongoDB `createIndex` calls. Run `ensureIndexes()` once
 * at application startup (e.g. in a middleware or during DB init).
 *
 * Compound unique indexes are created as unique indexes with the
 * `unique: true` option. Sparse indexes use `sparse: true`.
 */
import {
  usersCol,
  accountsCol,
  sessionsCol,
  verificationTokensCol,
  promptsCol,
  categoriesCol,
  tagsCol,
  pinnedPromptsCol,
  collectionsCol,
  categorySubscriptionsCol,
  commentsCol,
  notificationsCol,
  promptConnectionsCol,
  webhookConfigsCol,
  changeRequestsCol,
} from "@/lib/mongodb";

/**
 * Create all indexes defined in the Prisma schema.
 * Safe to call multiple times — MongoDB will no-op if the index already exists.
 */
export async function ensureIndexes(): Promise<void> {
  await Promise.allSettled([
    // ============================================================
    // users
    // ============================================================
    usersCol().createIndex({ id: 1 }, { unique: true }),
    usersCol().createIndex({ email: 1 }, { unique: true }),
    usersCol().createIndex({ username: 1 }, { unique: true }),
    usersCol().createIndex({ apiKey: 1 }, { sparse: true }),

    // ============================================================
    // accounts
    // ============================================================
    accountsCol().createIndex(
      { provider: 1, providerAccountId: 1 },
      { unique: true }
    ),
    accountsCol().createIndex({ userId: 1 }),

    // ============================================================
    // sessions
    // ============================================================
    sessionsCol().createIndex(
      { sessionToken: 1 },
      { unique: true }
    ),
    sessionsCol().createIndex({ userId: 1 }),

    // ============================================================
    // verification_tokens
    // ============================================================
    verificationTokensCol().createIndex(
      { identifier: 1, token: 1 },
      { unique: true }
    ),

    // ============================================================
    // prompts
    // ============================================================
    promptsCol().createIndex({ authorId: 1 }),
    promptsCol().createIndex({ categoryId: 1 }),
    promptsCol().createIndex({ type: 1 }),
    promptsCol().createIndex({ isPrivate: 1 }),
    promptsCol().createIndex({ isFeatured: 1 }),
    promptsCol().createIndex({ isUnlisted: 1 }),
    promptsCol().createIndex({ slug: 1 }, { sparse: true }),
    promptsCol().createIndex(
      { isPrivate: 1, isUnlisted: 1, deletedAt: 1, createdAt: -1 },
      { name: "idx_prompts_list_filter" }
    ),

    // ============================================================
    // categories
    // ============================================================
    categoriesCol().createIndex(
      { slug: 1 },
      { unique: true }
    ),
    categoriesCol().createIndex({ parentId: 1 }),
    categoriesCol().createIndex({ pinned: 1 }),

    // ============================================================
    // tags
    // ============================================================
    tagsCol().createIndex(
      { name: 1 },
      { unique: true }
    ),
    tagsCol().createIndex(
      { slug: 1 },
      { unique: true }
    ),

    // ============================================================
    // pinned_prompts
    // ============================================================
    pinnedPromptsCol().createIndex({ userId: 1 }),

    // ============================================================
    // collections
    // ============================================================
    collectionsCol().createIndex({ userId: 1 }),
    collectionsCol().createIndex({ promptId: 1 }),

    // ============================================================
    // category_subscriptions
    // ============================================================
    categorySubscriptionsCol().createIndex({ userId: 1 }),
    categorySubscriptionsCol().createIndex({ categoryId: 1 }),

    // ============================================================
    // comments
    // ============================================================
    commentsCol().createIndex({ promptId: 1 }),
    commentsCol().createIndex({ authorId: 1 }),
    commentsCol().createIndex({ parentId: 1 }),

    // ============================================================
    // notifications
    // ============================================================
    notificationsCol().createIndex({ userId: 1 }),
    notificationsCol().createIndex({ userId: 1, read: 1 }),

    // ============================================================
    // prompt_connections
    // ============================================================
    promptConnectionsCol().createIndex(
      { sourceId: 1, targetId: 1 },
      { unique: true }
    ),
    promptConnectionsCol().createIndex({ sourceId: 1 }),
    promptConnectionsCol().createIndex({ targetId: 1 }),

    // ============================================================
    // webhook_configs  — no indexes in Prisma schema
    // ============================================================

    // ============================================================
    // change_requests
    // ============================================================
    changeRequestsCol().createIndex({ promptId: 1 }),
    changeRequestsCol().createIndex({ authorId: 1 }),
    changeRequestsCol().createIndex({ status: 1 }),
  ]);
}
