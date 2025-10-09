
import { query, mutation } from "./_generated/server.js";
import { v } from "convex/values";

// Get the oldest pending job for a client
export const getOldestPendingJob = query({
  args: { clientId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("printJobs")
      .withIndex("by_clientId", (q) => q.eq("clientId", args.clientId))
      .filter((q) => q.eq(q.field("status"), "pending"))
      .order("asc")
      .first();
  },
});

// Update the status of a print job
export const updateJobStatus = mutation({
  args: {
    jobId: v.id("printJobs"),
    status: v.string(),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { jobId, status, error }) => {
    await ctx.db.patch(jobId, { status, error });
  },
});

// Create a new print job
export const createPrintJob = mutation({
  args: {
    clientId: v.string(),
    printerId: v.string(),
    fileStorageId: v.id("_storage"),
    cupsOptions: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("printJobs", {
      ...args,
      status: "pending",
    });
  },
});

// Get a specific job by ID
export const getJob = query({
  args: { jobId: v.id("printJobs") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.jobId);
  },
});

// Get the URL for a file in storage
export const getStorageUrl = query({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    return await ctx.storage.getUrl(args.storageId);
  },
});
