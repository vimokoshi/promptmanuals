/**
 * MongoDB environment configuration.
 *
 * This module validates and documents the environment variables
 * required for the MongoDB connection.
 */

/**
 * MongoDB Atlas connection string.
 * Format: mongodb+srv://user:password@host.mongodb.net/dbname
 *
 * Supports:
 * - MongoDB Atlas (cloud)
 * - MongoDB Atlas Local (self-hosted)
 * - Self-managed MongoDB instances
 */
export const MONGODB_URI =
  process.env.MONGODB_URI ??
  (() => {
    if (process.env.NODE_ENV === "development") {
      // Allow unconfigured in dev — will throw at runtime if used
      return "mongodb://localhost:27017/promptmanuals";
    }
    throw new Error("MONGODB_URI environment variable is not set");
  })();
