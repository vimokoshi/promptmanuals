/**
 * Legacy Prisma db shim — re-exports MongoDB helpers + a safe stub for the
 * old `db` Prisma client. 87 files still import { db } from here; those
 * routes need migration to @/lib/mongodb but the stub prevents hard crashes.
 *
 * TODO: Remove once all callers are migrated to @/lib/mongodb.
 */
export { getDb, getClient, connectMongo, closeMongo } from "@/lib/mongodb";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const handler: any = {
  get: (_: unknown, prop: string) => {
    // Return a no-op async function for any method call (findMany, findFirst, etc.)
    const model = new Proxy(
      {},
      {
        get: (_t, method: string) =>
          async (..._args: unknown[]) => {
            if (method === "count") return 0;
            if (method === "findUnique" || method === "findFirst") return null;
            if (method === "upsert" || method === "create" || method === "update") return null;
            if (method === "delete" || method === "deleteMany") return { count: 0 };
            if (method === "updateMany" || method === "createMany") return { count: 0 };
            return [];
          },
      }
    );
    return prop === "$connect" || prop === "$disconnect"
      ? async () => undefined
      : model;
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const db: any = new Proxy({}, handler);
