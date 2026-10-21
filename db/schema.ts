import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// The user key is supplied by Sites authentication, never by a browser payload.
export const progressSnapshots = sqliteTable("progress_snapshots", {
  userId: text("user_id").primaryKey(),
  stateJson: text("state_json").notNull(),
  revision: integer("revision").notNull(),
  updatedAt: text("updated_at").notNull(),
});
