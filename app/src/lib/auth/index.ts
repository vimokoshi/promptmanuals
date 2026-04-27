import NextAuth from "next-auth";
import {
  usersCol,
  accountsCol,
  sessionsCol,
  verificationTokensCol,
} from "@/lib/mongodb";
import { getConfig } from "@/lib/config";
import { initializePlugins, getAuthPlugin } from "@/lib/plugins";
import type { Adapter, AdapterUser, AdapterAccount, AdapterSession, VerificationToken } from "next-auth/adapters";
import { ObjectId } from "mongodb";

// Initialize plugins before use
initializePlugins();

// Generate a unique username from email or name
async function generateUsername(email: string, name?: string | null): Promise<string> {
  let baseUsername = email.split("@")[0].toLowerCase().replace(/[^a-z0-9_]/g, "");
  if (baseUsername.length < 3 && name) {
    baseUsername = name.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 15);
  }
  if (baseUsername.length < 3) baseUsername = "user";

  let username = baseUsername;
  let counter = 1;
  while (await usersCol().findOne({ username })) {
    username = `${baseUsername}${counter}`;
    counter++;
  }
  return username;
}

function docToAdapterUser(doc: { _id: ObjectId; email: string; name?: string | null; avatar?: string | null; emailVerified?: Date | null }): AdapterUser {
  return {
    id: doc._id.toHexString(),
    email: doc.email,
    name: doc.name ?? null,
    image: doc.avatar ?? null,
    emailVerified: doc.emailVerified ?? null,
  };
}

// Custom MongoDB adapter built on top of our MongoDB collections
function buildCustomAdapter(): Adapter {
  return {
    async createUser(data: AdapterUser & { username?: string; githubUsername?: string }) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let username = (data as any).username as string | undefined;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const githubUsername = (data as any).githubUsername as string | undefined;

      if (!username) {
        username = await generateUsername(data.email, data.name);
      } else {
        username = username.toLowerCase();
        const unclaimedEmail = `${username}@unclaimed.prompts.chat`;
        const unclaimedUser = await usersCol().findOne({ email: unclaimedEmail });

        if (unclaimedUser) {
          await usersCol().updateOne(
            { _id: unclaimedUser._id },
            {
              $set: {
                name: data.name ?? null,
                email: data.email,
                avatar: data.image ?? null,
                emailVerified: data.emailVerified ?? null,
                updatedAt: new Date(),
                ...(githubUsername ? { githubUsername } : {}),
              },
            }
          );
          const claimed = await usersCol().findOne({ _id: unclaimedUser._id });
          if (!claimed) throw new Error("Failed to claim user");
          return docToAdapterUser(claimed);
        }

        const baseUsername = username;
        let finalUsername = baseUsername;
        let counter = 1;
        while (await usersCol().findOne({ username: finalUsername })) {
          finalUsername = `${baseUsername}${counter}`;
          counter++;
        }
        username = finalUsername;
      }

      const now = new Date();
      const oid = new ObjectId();
      await usersCol().insertOne({
        _id: oid,
        email: data.email,
        username,
        name: data.name ?? null,
        password: null,
        avatar: data.image ?? null,
        bio: null,
        customLinks: null,
        role: "USER",
        locale: "en",
        emailVerified: data.emailVerified ?? null,
        createdAt: now,
        updatedAt: now,
        verified: false,
        githubUsername: githubUsername ?? null,
        apiKey: null,
        mcpPromptsPublicByDefault: false,
        flagged: false,
        flaggedAt: null,
        flaggedReason: null,
        dailyGenerationLimit: 10,
        generationCreditsRemaining: 10,
        generationCreditsResetAt: null,
      });

      return { id: oid.toHexString(), email: data.email, name: data.name ?? null, image: data.image ?? null, emailVerified: data.emailVerified ?? null };
    },

    async getUser(id: string) {
      try {
        const doc = await usersCol().findOne({ _id: new ObjectId(id) });
        return doc ? docToAdapterUser(doc) : null;
      } catch { return null; }
    },

    async getUserByEmail(email: string) {
      const doc = await usersCol().findOne({ email });
      return doc ? docToAdapterUser(doc) : null;
    },

    async getUserByAccount({ provider, providerAccountId }: { provider: string; providerAccountId: string }) {
      const account = await accountsCol().findOne({ provider, providerAccountId });
      if (!account) return null;
      try {
        const doc = await usersCol().findOne({ _id: new ObjectId(account.userId) });
        return doc ? docToAdapterUser(doc) : null;
      } catch { return null; }
    },

    async updateUser(data: Partial<AdapterUser> & { id: string }) {
      const { id, ...rest } = data;
      const update: Record<string, unknown> = { updatedAt: new Date() };
      if (rest.name !== undefined) update.name = rest.name;
      if (rest.image !== undefined) update.avatar = rest.image;
      if (rest.email !== undefined) update.email = rest.email;
      if (rest.emailVerified !== undefined) update.emailVerified = rest.emailVerified;
      try {
        await usersCol().updateOne({ _id: new ObjectId(id) }, { $set: update });
        const doc = await usersCol().findOne({ _id: new ObjectId(id) });
        if (!doc) throw new Error("User not found after update");
        return docToAdapterUser(doc);
      } catch (e) { throw e; }
    },

    async deleteUser(id: string) {
      try { await usersCol().deleteOne({ _id: new ObjectId(id) }); } catch { /* ignore */ }
    },

    async linkAccount(account: AdapterAccount) {
      const now = new Date();
      await accountsCol().insertOne({
        _id: new ObjectId(),
        userId: account.userId,
        type: account.type,
        provider: account.provider,
        providerAccountId: account.providerAccountId,
        refresh_token: (account.refresh_token as string | undefined) ?? null,
        access_token: (account.access_token as string | undefined) ?? null,
        expires_at: (account.expires_at as number | undefined) ?? null,
        token_type: (account.token_type as string | undefined) ?? null,
        scope: (account.scope as string | undefined) ?? null,
        id_token: (account.id_token as string | undefined) ?? null,
        session_state: (account.session_state as string | undefined) ?? null,
        createdAt: now,
        updatedAt: now,
      } as Parameters<ReturnType<typeof accountsCol>["insertOne"]>[0]);
    },

    async unlinkAccount({ provider, providerAccountId }: { provider: string; providerAccountId: string }) {
      await accountsCol().deleteOne({ provider, providerAccountId });
    },

    async createSession(session: AdapterSession) {
      await sessionsCol().insertOne({
        _id: new ObjectId(),
        sessionToken: session.sessionToken,
        userId: session.userId,
        expires: session.expires,
      } as Parameters<ReturnType<typeof sessionsCol>["insertOne"]>[0]);
      return session;
    },

    async getSessionAndUser(sessionToken: string) {
      const session = await sessionsCol().findOne({ sessionToken });
      if (!session) return null;
      try {
        const user = await usersCol().findOne({ _id: new ObjectId(session.userId) });
        if (!user) return null;
        return {
          session: { sessionToken: session.sessionToken, userId: session.userId, expires: session.expires },
          user: docToAdapterUser(user),
        };
      } catch { return null; }
    },

    async updateSession({ sessionToken, expires, userId }: Partial<AdapterSession> & { sessionToken: string }) {
      const update: Record<string, unknown> = {};
      if (expires) update.expires = expires;
      if (userId) update.userId = userId;
      await sessionsCol().updateOne({ sessionToken }, { $set: update });
      const updated = await sessionsCol().findOne({ sessionToken });
      if (!updated) return null;
      return { sessionToken: updated.sessionToken, userId: updated.userId, expires: updated.expires };
    },

    async deleteSession(sessionToken: string) {
      await sessionsCol().deleteOne({ sessionToken });
    },

    async createVerificationToken(verificationToken: VerificationToken) {
      await verificationTokensCol().insertOne({
        _id: new ObjectId(),
        identifier: verificationToken.identifier,
        token: verificationToken.token,
        expires: verificationToken.expires,
      } as Parameters<ReturnType<typeof verificationTokensCol>["insertOne"]>[0]);
      return verificationToken;
    },

    async useVerificationToken({ identifier, token }: { identifier: string; token: string }) {
      const doc = await verificationTokensCol().findOneAndDelete({ identifier, token });
      if (!doc) return null;
      return { identifier: doc.identifier, token: doc.token, expires: doc.expires };
    },
  };
}

// Helper to get providers from config
function getConfiguredProviders(config: Awaited<ReturnType<typeof getConfig>>): string[] {
  if (config.auth.providers && config.auth.providers.length > 0) return config.auth.providers;
  if (config.auth.provider) return [config.auth.provider];
  return ["credentials"];
}

// Build auth config dynamically based on prompts.config.ts
async function buildAuthConfig() {
  const config = await getConfig();
  const providerIds = getConfiguredProviders(config);

  const authProviders = providerIds
    .map((id) => {
      const plugin = getAuthPlugin(id);
      if (!plugin) {
        console.warn(`Auth plugin "${id}" not found, skipping`);
        return null;
      }
      return plugin.getProvider();
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  if (authProviders.length === 0) {
    throw new Error(`No valid auth plugins found. Configured: ${providerIds.join(", ")}`);
  }

  return {
    adapter: buildCustomAdapter(),
    providers: authProviders,
    session: { strategy: "jwt" as const },
    pages: { signIn: "/login", signUp: "/register", error: "/login" },
    callbacks: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async jwt({ token, user, trigger }: { token: any; user?: any; trigger?: string }) {
        if (user && user.email) {
          const dbUser = await usersCol().findOne(
            { email: user.email },
            { projection: { _id: 1, role: 1, username: 1, locale: 1, name: 1, avatar: 1 } }
          );
          if (dbUser) {
            token.id = dbUser._id.toHexString();
            token.role = dbUser.role;
            token.username = dbUser.username;
            token.locale = dbUser.locale;
            token.name = dbUser.name;
            token.picture = dbUser.avatar;
          }
        }

        if (token.id && !user) {
          try {
            const dbUser = await usersCol().findOne(
              { _id: new ObjectId(token.id as string) },
              { projection: { _id: 1, role: 1, username: 1, locale: 1, name: 1, avatar: 1 } }
            );
            if (!dbUser) return null;
            if (trigger === "update" || !token.username) {
              token.role = dbUser.role;
              token.username = dbUser.username;
              token.locale = dbUser.locale;
              token.name = dbUser.name;
              token.picture = dbUser.avatar;
            }
          } catch { return null; }
        }

        return token;
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async session({ session, token }: { session: any; token: any }) {
        if (!token) return { ...session, user: undefined };
        if (token && session.user) {
          session.user.id = token.id as string;
          session.user.role = token.role as string;
          session.user.username = token.username as string;
          session.user.locale = token.locale as string;
          session.user.name = token.name ?? null;
          session.user.image = token.picture ?? null;
        }
        return session;
      },
    },
  };
}

// Export auth handlers
const authConfig = await buildAuthConfig();
export const { handlers, signIn, signOut, auth } = NextAuth(authConfig);

// Extended session type
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name?: string | null;
      image?: string | null;
      role: string;
      username: string;
      locale: string;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: string;
    username: string;
    locale: string;
    name?: string | null;
    picture?: string | null;
  }
}
