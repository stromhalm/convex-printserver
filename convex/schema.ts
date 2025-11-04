
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  printJobs: defineTable({
    clientId: v.string(),
    printerId: v.string(),
    fileStorageId: v.id("_storage"),
    cupsOptions: v.string(),
    status: v.string(), // "pending", "completed"
    context: v.optional(v.string()),
  })
    .index("by_clientId_status", ["clientId", "status"])
    .index("by_status", ["status"])
    .searchIndex("by_context", {
      searchField: "context",
    }),
});
