/**
 * NextAuth v5 MongoDB Adapter
 *
 * Implements the full Adapter interface for NextAuth (Auth.js) using the
 * native MongoDB driver. Replaces @auth/prisma-adapter.
 *
 * Reference: https://authjs.dev/reference/adapters/mongodb
 */
import { Document } from "mongodb";
import type { Adapter } from "next-auth/adapters";
import type {
  AdapterAccount,
  AdapterSession,
  AdapterUser,
} from "@auth/core/adapters";
import { getDb } from "@/lib/mongodb/schemas";

// ---------------------------------------------------------------------------
// Local collections proxy (matches the shape the adapter expects)
// ---------------------------------------------------------------------------

const db = () => getDb();

const collections = {
  users: () => db().collection("users"),
  accounts: () => db().collection("accounts"),
  sessions: () => db().collection("sessions"),
  verificationTokens: () => db().collection("verification_tokens"),
  prompts: () => db().collection("prompts"),
  categories: () => db().collection("categories"),
  tags: () => db().collection("tags"),
  pinnedPrompts: () => db().collection("pinned_prompts"),
  collections: () => db().collection("collections"),
  categorySubscriptions: () => db().collection("category_subscriptions"),
  comments: () => db().collection("comments"),
  notifications: () => db().collection("notifications"),
  promptConnections: () => db().collection("prompt_connections"),
  webhookConfigs: () => db().collection("webhook_configs"),
  changeRequests: () => db().collection("change_requests"),
  // Join tables used in deleteUser cascade
  promptVotes: () => db().collection("prompt_votes"),
  commentVotes: () => db().collection("comment_votes"),
  userCollections: () => db().collection("user_collections"),
  userPromptExamples: () => db().collection("user_prompt_examples"),
};

// ---------------------------------------------------------------------------
// Helper types
// ---------------------------------------------------------------------------

interface MongoUser {
  id: string;
  email: string;
  emailVerified?: Date | null;
  name?: string | null;
  image?: string | null;
}

interface MongoSession {
  id: string;
  sessionToken: string;
  userId: string;
  expires: Date;
}

interface MongoAccount extends AdapterAccount {
  id: string;
}

interface MongoVerificationToken {
  identifier: string;
  token: string;
  expires: Date;
}

// ---------------------------------------------------------------------------
// User
// ---------------------------------------------------------------------------

async function createUser(data: {
  id?: string;
  email: string;
  name?: string;
  image?: string;
}): Promise<MongoUser> {
  const user = {
    id: data.id ?? crypto.randomUUID(),
    email: data.email,
    name: data.name ?? null,
    emailVerified: null,
    image: data.image ?? null,
    username: null,
    githubUsername: null,
    role: "USER",
    locale: "en",
    createdAt: new Date(),
    updatedAt: new Date(),
    verified: false,
    flagged: false,
    dailyGenerationLimit: 3,
    generationCreditsRemaining: 3,
    generationCreditsResetAt: null,
    customLinks: [],
    avatar: data.image ?? null,
  };

  await collections.users().insertOne(user as unknown as Document);

  return {
    id: user.id,
    email: user.email,
    name: user.name ?? undefined,
    image: user.image ?? undefined,
    emailVerified: user.emailVerified ?? undefined,
  };
}

async function getUser(id: string): Promise<MongoUser | null> {
  const user = await collections.users().findOne({ id } as Record<string, unknown>);

  if (!user) return null;

  return {
    id: user.id as string,
    email: user.email as string,
    emailVerified: (user.emailVerified as Date | null) ?? undefined,
    name: (user.name as string | null) ?? undefined,
    image: (user.avatar as string | null) ?? undefined,
  };
}

async function getUserByEmail(email: string): Promise<MongoUser | null> {
  const user = await collections.users().findOne({
    email,
  } as Record<string, unknown>);

  if (!user) return null;

  return {
    id: user.id as string,
    email: user.email as string,
    emailVerified: (user.emailVerified as Date | null) ?? undefined,
    name: (user.name as string | null) ?? undefined,
    image: (user.avatar as string | null) ?? undefined,
  };
}

async function getUserByProviderAccountId(data: {
  provider: string;
  providerAccountId: string;
}): Promise<MongoUser | null> {
  const account = await collections.accounts().findOne({
    provider: data.provider,
    providerAccountId: data.providerAccountId,
  } as Record<string, unknown>);

  if (!account) return null;

  return getUser(account.userId as string);
}

async function updateUser(data: {
  id: string;
  email?: string;
  name?: string;
  image?: string;
  emailVerified?: Date | null;
}): Promise<MongoUser> {
  const updateData: Record<string, unknown> = {
    updatedAt: new Date(),
  };

  if (data.email !== undefined) updateData.email = data.email;
  if (data.name !== undefined) updateData.name = data.name;
  if (data.image !== undefined) {
    updateData.image = data.image;
    updateData.avatar = data.image;
  }
  if (data.emailVerified !== undefined) {
    updateData.emailVerified = data.emailVerified;
  }

  await collections.users().updateOne(
    { id: data.id } as Record<string, unknown>,
    { $set: updateData }
  );

  const user = await getUser(data.id);
  if (!user) throw new Error("User not found after update");

  return user;
}

async function deleteUser(id: string): Promise<void> {
  // Cascade: delete all related records
  await Promise.all([
    collections.users().deleteOne({ id } as Record<string, unknown>),
    collections.accounts().deleteMany({ userId: id } as Record<string, unknown>),
    collections.sessions().deleteMany({ userId: id } as Record<string, unknown>),
    collections.notifications().deleteMany({ userId: id } as Record<string, unknown>),
    collections.categorySubscriptions().deleteMany({ userId: id } as Record<string, unknown>),
    collections.promptVotes().deleteMany({ userId: id } as Record<string, unknown>),
    collections.pinnedPrompts().deleteMany({ userId: id } as Record<string, unknown>),
    collections.userCollections().deleteMany({ userId: id } as Record<string, unknown>),
    collections.commentVotes().deleteMany({ userId: id } as Record<string, unknown>),
    collections.userPromptExamples().deleteMany({ userId: id } as Record<string, unknown>),
  ]);
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

async function createSession(data: {
  sessionToken: string;
  userId: string;
  expires: Date;
}): Promise<MongoSession> {
  const session: MongoSession = {
    id: crypto.randomUUID(),
    sessionToken: data.sessionToken,
    userId: data.userId,
    expires: data.expires,
  };

  await collections.sessions().insertOne(session as unknown as Document);

  return session;
}

async function getSessionAndUser(data: {
  sessionToken: string;
}): Promise<{ session: MongoSession; user: MongoUser } | null> {
  const session = await collections.sessions().findOne({
    sessionToken: data.sessionToken,
  } as Record<string, unknown>);

  if (!session) return null;

  const user = await getUser(session.userId as string);
  if (!user) return null;

  return {
    session: {
      id: session.id as string,
      sessionToken: session.sessionToken as string,
      userId: session.userId as string,
      expires: session.expires as Date,
    },
    user,
  };
}

async function updateSession(data: {
  sessionToken: string;
  expires?: Date;
}): Promise<MongoSession | null> {
  const updateData: Record<string, unknown> = {};
  if (data.expires) updateData.expires = data.expires;

  await collections.sessions().updateOne(
    { sessionToken: data.sessionToken } as Record<string, unknown>,
    { $set: updateData }
  );

  const session = await collections.sessions().findOne({
    sessionToken: data.sessionToken,
  } as Record<string, unknown>);

  if (!session) return null;

  return {
    id: session.id as string,
    sessionToken: session.sessionToken as string,
    userId: session.userId as string,
    expires: session.expires as Date,
  };
}

async function deleteSession(sessionToken: string): Promise<void> {
  await collections.sessions().deleteOne({
    sessionToken,
  } as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// Account (OAuth)
// ---------------------------------------------------------------------------

async function linkAccount(data: {
  userId: string;
  provider: string;
  providerAccountId: string;
  type: string;
  refresh_token?: string | null;
  access_token?: string | null;
  expires_at?: number | null;
  token_type?: string | null;
  scope?: string | null;
  id_token?: string | null;
  session_state?: string | null;
}): Promise<MongoAccount> {
  const account: MongoAccount = {
    id: crypto.randomUUID(),
    userId: data.userId,
    provider: data.provider,
    providerAccountId: data.providerAccountId,
    type: data.type,
    refresh_token: data.refresh_token ?? null,
    access_token: data.access_token ?? null,
    expires_at: data.expires_at ?? null,
    token_type: data.token_type ?? null,
    scope: data.scope ?? null,
    id_token: data.id_token ?? null,
    session_state: data.session_state ?? null,
  } as unknown as MongoAccount;

  await collections.accounts().insertOne(account as unknown as Document);

  return account;
}

async function unlinkAccount(data: {
  provider: string;
  providerAccountId: string;
}): Promise<void> {
  await collections.accounts().deleteOne({
    provider: data.provider,
    providerAccountId: data.providerAccountId,
  } as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// VerificationToken
// ---------------------------------------------------------------------------

async function createVerificationToken(data: {
  identifier: string;
  token: string;
  expires: Date;
}): Promise<MongoVerificationToken | null> {
  const tokenDoc: MongoVerificationToken = {
    identifier: data.identifier,
    token: data.token,
    expires: data.expires,
  };

  await collections.verificationTokens().insertOne(tokenDoc as unknown as Document);

  return tokenDoc;
}

async function useVerificationToken(data: {
  token: string;
}): Promise<MongoVerificationToken | null> {
  const result = await collections.verificationTokens().findOneAndDelete({
    token: data.token,
  } as Record<string, unknown>);

  if (!result) return null;

  return {
    identifier: result.identifier as string,
    token: result.token as string,
    expires: result.expires as Date,
  };
}

// ---------------------------------------------------------------------------
// Adapter export
// ---------------------------------------------------------------------------

/**
 * NextAuth v5 MongoDB adapter.
 * Pass this as the `adapter` option in your NextAuth config.
 */
export const MongoDBAdapter = (): Adapter => {
  const adapter = {
    // User
    createUser: createUser as Adapter["createUser"],
    getUser: getUser as Adapter["getUser"],
    getUserByEmail: getUserByEmail as Adapter["getUserByEmail"],
    getUserByProviderAccountId,
    updateUser: updateUser as Adapter["updateUser"],
    deleteUser: deleteUser as Adapter["deleteUser"],

    // Session
    createSession: createSession as Adapter["createSession"],
    getSessionAndUser: getSessionAndUser as unknown as Adapter["getSessionAndUser"],
    updateSession: updateSession as Adapter["updateSession"],
    deleteSession: deleteSession as Adapter["deleteSession"],

    // Account
    linkAccount: linkAccount as Adapter["linkAccount"],
    unlinkAccount: unlinkAccount as Adapter["unlinkAccount"],

    // VerificationToken
    createVerificationToken,
    useVerificationToken,
  };
  return adapter as unknown as Adapter;
};
