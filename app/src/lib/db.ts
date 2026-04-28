/**
 * Legacy re-export shim.
 *
 * All source files have been migrated to import directly from "@/lib/mongodb".
 * This file satisfies remaining imports of "@/lib/db" during the migration period.
 *
 * TODO: Remove this file once all imports are updated to "@/lib/mongodb".
 */
export { getDb, getClient, connectMongo, closeMongo } from "@/lib/mongodb";

// Legacy Prisma `db` stub — routes using this must be migrated to MongoDB helpers.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const db: any = {};
