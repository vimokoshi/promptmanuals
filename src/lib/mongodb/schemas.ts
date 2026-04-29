/**
 * src/lib/mongodb/schemas.ts
 *
 * MongoDB collection schemas and client singleton for MongoDB Atlas.
 *
 * Design matches the hybrid schema defined in plans/reports/migration-01-schema-design.md
 * - Embeds: tags[], votes[], versions[], userExamples[], reports[] on prompts
 * - Separate collections for independently-queried entities
 * - All date fields are stored as JS Date objects (MongoDB native)
 * - All IDs are MongoDB ObjectId strings (24 hex chars)
 */

import { MongoClient, Db, Collection, Document, ObjectId } from "mongodb";

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const DB_NAME = process.env.MONGODB_DB ?? "promptmanuals";

// ---------------------------------------------------------------------------
// Singleton client
// ---------------------------------------------------------------------------

const globalForMongo = globalThis as unknown as {
  mongoClient: MongoClient | undefined;
  mongoDb: Db | undefined;
};

function createMongoClient(): MongoClient {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error(
      "MONGODB_URI environment variable is not set.\n" +
        "Set it to your MongoDB Atlas connection string:\n" +
        '  mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/<db>?retryWrites=true&w=majority'
    );
  }
  return new MongoClient(uri, {
    maxPoolSize: 10,
    minPoolSize: 2,
    maxIdleTimeMS: 30_000,
    serverSelectionTimeoutMS: 10_000,
    connectTimeoutMS: 10_000,
  });
}

export function getDb(): Db {
  if (!globalForMongo.mongoClient) {
    globalForMongo.mongoClient = createMongoClient();
  }
  if (!globalForMongo.mongoDb) {
    globalForMongo.mongoDb = globalForMongo.mongoClient.db(DB_NAME);
  }
  return globalForMongo.mongoDb;
}

export function getClient(): MongoClient {
  if (!globalForMongo.mongoClient) {
    globalForMongo.mongoClient = createMongoClient();
  }
  return globalForMongo.mongoClient;
}

/** Call once at application startup; close on graceful shutdown */
export async function connectMongo(): Promise<Db> {
  const client = getClient();
  await client.connect();
  return getDb();
}

/** Call on process SIGTERM/SIGINT */
export async function closeMongo(): Promise<void> {
  if (globalForMongo.mongoClient) {
    await globalForMongo.mongoClient.close();
    globalForMongo.mongoClient = undefined;
    globalForMongo.mongoDb = undefined;
  }
}

// ---------------------------------------------------------------------------
// Enum types (TypeScript string literal unions)
// ---------------------------------------------------------------------------

export type UserRole = "ADMIN" | "USER";
export type PromptType =
  | "TEXT"
  | "IMAGE"
  | "VIDEO"
  | "AUDIO"
  | "STRUCTURED"
  | "SKILL"
  | "TASTE";
export type StructuredFormat = "JSON" | "YAML";
export type RequiredMediaType = "IMAGE" | "VIDEO" | "DOCUMENT";
export type ReportReason =
  | "SPAM"
  | "INAPPROPRIATE"
  | "COPYRIGHT"
  | "MISLEADING"
  | "RELIST_REQUEST"
  | "OTHER";
export type ReportStatus = "PENDING" | "REVIEWED" | "DISMISSED";
export type NotificationType = "COMMENT" | "REPLY";
export type ChangeRequestStatus = "PENDING" | "APPROVED" | "REJECTED";
export type DelistReason =
  | "TOO_SHORT"
  | "NOT_ENGLISH"
  | "LOW_QUALITY"
  | "NOT_LLM_INSTRUCTION"
  | "MANUAL"
  | "UNUSUAL_ACTIVITY";
export type WebhookEvent =
  | "PROMPT_CREATED"
  | "PROMPT_UPDATED"
  | "PROMPT_DELETED";

// ---------------------------------------------------------------------------
// Sub-document types (embedded in parent documents)
// ---------------------------------------------------------------------------

export interface EmbeddedTag {
  _id: string;
  name: string;
  slug: string;
  color: string;
}

export interface EmbeddedVote {
  userId: string;
  createdAt: Date;
}

export interface EmbeddedVersion {
  _id: string;
  version: number;
  content: string;
  changeNote: string | null;
  createdAt: Date;
  createdBy: string;
}

export interface EmbeddedExample {
  _id: string;
  mediaUrl: string;
  comment: string | null;
  createdAt: Date;
  userId: string;
}

export interface EmbeddedReport {
  _id: string;
  reason: ReportReason;
  details: string | null;
  status: ReportStatus;
  createdAt: Date;
  updatedAt: Date;
  reporterId: string;
}

export interface EmbeddedCommentVote {
  userId: string;
  value: number; // 1 = upvote, -1 = downvote
  createdAt: Date;
}

export interface MCPToolConfig {
  command: string;
  tools: string[];
}

export interface TranslationEntry {
  title: string;
  content: string;
}

export interface CustomLink {
  type: string;
  url: string;
  label?: string;
}

// ---------------------------------------------------------------------------
// Collection document types
// ---------------------------------------------------------------------------

export interface UserDocument extends Document {
  _id: ObjectId;
  email: string;
  username: string;
  name: string | null;
  password: string | null;
  avatar: string | null;
  bio: string | null;
  customLinks: CustomLink[] | null;
  role: UserRole;
  locale: string;
  emailVerified: Date | null;
  createdAt: Date;
  updatedAt: Date;
  verified: boolean;
  githubUsername: string | null;
  apiKey: string | null;
  mcpPromptsPublicByDefault: boolean;
  flagged: boolean;
  flaggedAt: Date | null;
  flaggedReason: string | null;
  dailyGenerationLimit: number;
  generationCreditsRemaining: number;
  generationCreditsResetAt: Date | null;
}

export interface AccountDocument extends Document {
  _id: ObjectId;
  userId: string;
  type: string;
  provider: string;
  providerAccountId: string;
  refresh_token: string | null;
  access_token: string | null;
  expires_at: number | null;
  token_type: string | null;
  scope: string | null;
  id_token: string | null;
  session_state: string | null;
}

export interface SessionDocument extends Document {
  _id: ObjectId;
  sessionToken: string;
  userId: string;
  expires: Date;
}

export interface VerificationTokenDocument extends Document {
  _id: ObjectId;
  identifier: string;
  token: string;
  expires: Date;
}

export interface PromptDocument extends Document {
  _id: ObjectId;
  title: string;
  slug: string | null;
  description: string | null;
  content: string;
  type: PromptType;
  isPrivate: boolean;
  mediaUrl: string | null;
  viewCount: number;
  createdAt: Date;
  updatedAt: Date;
  authorId: string;
  categoryId: string | null;
  embedding: number[] | null;
  requiredMediaCount: number | null;
  requiredMediaType: RequiredMediaType | null;
  requiresMediaUpload: boolean;
  structuredFormat: StructuredFormat | null;
  featuredAt: Date | null;
  isFeatured: boolean;
  isUnlisted: boolean;
  unlistedAt: Date | null;
  delistReason: DelistReason | null;
  deletedAt: Date | null;
  // --- embedded from join tables ---
  tags: EmbeddedTag[];
  voteCount: number;
  votes: EmbeddedVote[];
  versions: EmbeddedVersion[];
  userExamples: EmbeddedExample[];
  reports: EmbeddedReport[];
  // --- rich content fields ---
  bestWithModels: string[];
  bestWithMCP: MCPToolConfig[] | null;
  workflowLink: string | null;
  translations: Record<string, TranslationEntry> | null;
  seoMeta: Record<string, unknown> | null;
}

export interface CategoryDocument extends Document {
  _id: ObjectId;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  order: number;
  pinned: boolean;
  parentId: string | null;
}

export interface TagDocument extends Document {
  _id: ObjectId;
  name: string;
  slug: string;
  color: string;
}

export interface PinnedPromptDocument extends Document {
  _id: ObjectId;
  userId: string;
  promptId: string;
  order: number;
  createdAt: Date;
}

export interface CollectionDocument extends Document {
  _id: ObjectId;
  userId: string;
  promptId: string;
  createdAt: Date;
}

export interface CategorySubscriptionDocument extends Document {
  _id: ObjectId;
  userId: string;
  categoryId: string;
  createdAt: Date;
}

export interface CommentDocument extends Document {
  _id: ObjectId;
  content: string;
  score: number;
  createdAt: Date;
  updatedAt: Date;
  promptId: string;
  authorId: string;
  parentId: string | null;
  flagged: boolean;
  flaggedAt: Date | null;
  flaggedBy: string | null;
  deletedAt: Date | null;
  votes: EmbeddedCommentVote[];
}

export interface NotificationDocument extends Document {
  _id: ObjectId;
  type: NotificationType;
  read: boolean;
  createdAt: Date;
  userId: string;
  actorId: string | null;
  promptId: string | null;
  commentId: string | null;
}

export interface PromptConnectionDocument extends Document {
  _id: ObjectId;
  sourceId: string;
  targetId: string;
  label: string;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface WebhookConfigDocument extends Document {
  _id: ObjectId;
  name: string;
  url: string;
  method: string;
  headers: Record<string, string> | null;
  payload: string;
  events: WebhookEvent[];
  isEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChangeRequestDocument extends Document {
  _id: ObjectId;
  proposedContent: string;
  proposedTitle: string | null;
  reason: string | null;
  status: ChangeRequestStatus;
  reviewNote: string | null;
  createdAt: Date;
  updatedAt: Date;
  promptId: string;
  authorId: string;
  originalContent: string;
  originalTitle: string;
}

// ---------------------------------------------------------------------------
// Collection accessors
// ---------------------------------------------------------------------------

export function usersCollection(): Collection<UserDocument> {
  return getDb().collection<UserDocument>("users");
}

export function accountsCollection(): Collection<AccountDocument> {
  return getDb().collection<AccountDocument>("accounts");
}

export function sessionsCollection(): Collection<SessionDocument> {
  return getDb().collection<SessionDocument>("sessions");
}

export function verificationTokensCollection(): Collection<VerificationTokenDocument> {
  return getDb().collection<VerificationTokenDocument>("verification_tokens");
}

export function promptsCollection(): Collection<PromptDocument> {
  return getDb().collection<PromptDocument>("prompts");
}

export function categoriesCollection(): Collection<CategoryDocument> {
  return getDb().collection<CategoryDocument>("categories");
}

export function tagsCollection(): Collection<TagDocument> {
  return getDb().collection<TagDocument>("tags");
}

export function pinnedPromptsCollection(): Collection<PinnedPromptDocument> {
  return getDb().collection<PinnedPromptDocument>("pinned_prompts");
}

export function collectionsCollection(): Collection<CollectionDocument> {
  return getDb().collection<CollectionDocument>("collections");
}

export function categorySubscriptionsCollection(): Collection<CategorySubscriptionDocument> {
  return getDb().collection<CategorySubscriptionDocument>("category_subscriptions");
}

export function commentsCollection(): Collection<CommentDocument> {
  return getDb().collection<CommentDocument>("comments");
}

export function notificationsCollection(): Collection<NotificationDocument> {
  return getDb().collection<NotificationDocument>("notifications");
}

export function promptConnectionsCollection(): Collection<PromptConnectionDocument> {
  return getDb().collection<PromptConnectionDocument>("prompt_connections");
}

export function webhookConfigsCollection(): Collection<WebhookConfigDocument> {
  return getDb().collection<WebhookConfigDocument>("webhook_configs");
}

export function changeRequestsCollection(): Collection<ChangeRequestDocument> {
  return getDb().collection<ChangeRequestDocument>("change_requests");
}

// ---------------------------------------------------------------------------
// Index definitions
// ---------------------------------------------------------------------------

/** Run once after migrating data to create all recommended indexes */
export async function createIndexes(): Promise<void> {
  const db = getDb();

  await Promise.all([
    // users
    db.collection("users").createIndexes([
      { key: { email: 1 }, unique: true },
      { key: { username: 1 }, unique: true },
      { key: { apiKey: 1 }, unique: true, sparse: true },
      { key: { role: 1 } },
      { key: { flagged: 1 } },
    ]),

    // accounts
    db.collection("accounts").createIndexes([
      { key: { provider: 1, providerAccountId: 1 }, unique: true },
      { key: { userId: 1 } },
    ]),

    // sessions
    db.collection("sessions").createIndexes([
      { key: { sessionToken: 1 }, unique: true },
      { key: { userId: 1 } },
    ]),

    // prompts
    db.collection("prompts").createIndexes([
      { key: { authorId: 1 } },
      { key: { categoryId: 1 } },
      { key: { type: 1 } },
      { key: { isPrivate: 1 } },
      { key: { isFeatured: 1 } },
      { key: { isUnlisted: 1 } },
      { key: { slug: 1 }, unique: true, sparse: true },
      { key: { isPrivate: 1, isUnlisted: 1, deletedAt: 1, createdAt: -1 } },
      // Full-text search on title + content
      { key: { title: "text", content: "text", description: "text" } },
      // Tags for $lookup + $match
      { key: { "tags.slug": 1 } },
    ]),

    // categories
    db.collection("categories").createIndexes([
      { key: { slug: 1 }, unique: true },
      { key: { parentId: 1 } },
      { key: { pinned: 1 } },
      { key: { order: 1 } },
    ]),

    // tags
    db.collection("tags").createIndexes([
      { key: { name: 1 }, unique: true },
      { key: { slug: 1 }, unique: true },
    ]),

    // comments
    db.collection("comments").createIndexes([
      { key: { promptId: 1 } },
      { key: { authorId: 1 } },
      { key: { parentId: 1 } },
      { key: { score: -1 } },
    ]),

    // notifications
    db.collection("notifications").createIndexes([
      { key: { userId: 1 } },
      { key: { userId: 1, read: 1 } },
    ]),

    // pinned_prompts
    db.collection("pinned_prompts").createIndexes([
      { key: { userId: 1, promptId: 1 }, unique: true },
      { key: { userId: 1 } },
    ]),

    // collections
    db.collection("collections").createIndexes([
      { key: { userId: 1, promptId: 1 }, unique: true },
      { key: { userId: 1 } },
      { key: { promptId: 1 } },
    ]),

    // category_subscriptions
    db.collection("category_subscriptions").createIndexes([
      { key: { userId: 1, categoryId: 1 }, unique: true },
      { key: { userId: 1 } },
      { key: { categoryId: 1 } },
    ]),

    // prompt_connections
    db.collection("prompt_connections").createIndexes([
      { key: { sourceId: 1, targetId: 1 }, unique: true },
      { key: { sourceId: 1 } },
      { key: { targetId: 1 } },
    ]),

    // webhook_configs
    db.collection("webhook_configs").createIndexes([
      { key: { isEnabled: 1 } },
    ]),

    // change_requests
    db.collection("change_requests").createIndexes([
      { key: { promptId: 1 } },
      { key: { authorId: 1 } },
      { key: { status: 1 } },
    ]),
  ]);

  console.log("All MongoDB indexes created successfully.");
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

export function isObjectId(val: unknown): val is string {
  return (
    typeof val === "string" &&
    /^[0-9a-fA-F]{24}$/.test(val)
  );
}

export function toObjectId(id: string): ObjectId {
  return new ObjectId(id);
}
