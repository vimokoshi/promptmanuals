/**
 * MongoDB database layer — single source of truth.
 *
 * Re-exports everything from schemas.ts (typed interfaces, singleton, createIndexes)
 * and adds ergonomic collection helpers on top.
 *
 * Usage:
 *   import { getDb, promptsCol, usersCol, createIndexes } from "@/lib/mongodb"
 */
export {
  // Client & connection
  getClient,
  getDb,
  connectMongo,
  closeMongo,
  // Enum types
  type UserRole,
  type PromptType,
  type StructuredFormat,
  type RequiredMediaType,
  type ReportReason,
  type ReportStatus,
  type NotificationType,
  type ChangeRequestStatus,
  type DelistReason,
  type WebhookEvent,
  // Sub-document types
  type EmbeddedTag,
  type EmbeddedVote,
  type EmbeddedVersion,
  type EmbeddedExample,
  type EmbeddedReport,
  type EmbeddedCommentVote,
  type MCPToolConfig,
  type TranslationEntry,
  type CustomLink,
  // Document types
  type UserDocument,
  type AccountDocument,
  type SessionDocument,
  type VerificationTokenDocument,
  type PromptDocument,
  type CategoryDocument,
  type TagDocument,
  type PinnedPromptDocument,
  type CollectionDocument,
  type CommentDocument,
  type NotificationDocument,
  type PromptConnectionDocument,
  type WebhookConfigDocument,
  type ChangeRequestDocument,
  // Indexes
  createIndexes,
  // Type guards
  isObjectId,
  toObjectId,
} from "./schemas";

// ---------------------------------------------------------------------------
// Ergonomic collection helpers (typed, no generic needed)
// ---------------------------------------------------------------------------
import {
  usersCollection,
  accountsCollection,
  sessionsCollection,
  verificationTokensCollection,
  promptsCollection,
  categoriesCollection,
  tagsCollection,
  pinnedPromptsCollection,
  collectionsCollection,
  categorySubscriptionsCollection,
  commentsCollection,
  notificationsCollection,
  promptConnectionsCollection,
  webhookConfigsCollection,
  changeRequestsCollection,
} from "./schemas";

export const usersCol = usersCollection;
export const accountsCol = accountsCollection;
export const sessionsCol = sessionsCollection;
export const verificationTokensCol = verificationTokensCollection;
export const promptsCol = promptsCollection;
export const categoriesCol = categoriesCollection;
export const tagsCol = tagsCollection;
export const pinnedPromptsCol = pinnedPromptsCollection;
export const collectionsCol = collectionsCollection;
export const categorySubscriptionsCol = categorySubscriptionsCollection;
export const commentsCol = commentsCollection;
export const notificationsCol = notificationsCollection;
export const promptConnectionsCol = promptConnectionsCollection;
export const webhookConfigsCol = webhookConfigsCollection;
export const changeRequestsCol = changeRequestsCollection;
