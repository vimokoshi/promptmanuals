/**
 * Legacy re-export shim.
 *
 * All source files have been migrated to import directly from "@/lib/mongodb".
 * This file satisfies any remaining "@/lib/db" imports during migration.
 *
 * TODO: Remove this file once all imports are updated to "@/lib/mongodb".
 */
export { getDb, getClient, connectMongo, closeMongo } from "@/lib/mongodb";
