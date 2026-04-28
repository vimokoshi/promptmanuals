/**
 * Legacy re-export shim.
 *
 * All source files have been migrated to import directly from "@/lib/mongodb".
 * This file is kept to satisfy any remaining imports of "@/lib/db" during the
 * migration period; it simply re-exports the MongoDB helpers.
 *
 * TODO: Remove this file once all imports are updated to "@/lib/mongodb".
 */
export { getDb, getClient, connectMongo, closeMongo } from "@/lib/mongodb";
