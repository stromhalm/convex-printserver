
import { query, mutation } from "./_generated/server.js";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel.js";

// Atomically claim a job for a client and return it with file URL
export const claimJob = mutation({
  args: { jobId: v.id("printJobs"), apiKey: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const expectedApiKey = process.env.API_KEY;
    if (expectedApiKey) {
      if (args.apiKey !== expectedApiKey) {
        throw new Error("Unauthorized");
      }
    } else {
      if (process.env.NODE_ENV !== "test") {
        console.warn("Warning: API_KEY not set; allowing unauthenticated access to claimJob.");
      }
    }
    
    const job = await ctx.db.get(args.jobId);
    
    if (!job) return null;
    
    // Atomically mark as completed and get file URL in parallel
    const [, fileUrl] = await Promise.all([
      ctx.db.patch(job._id, { status: "completed" }),
      ctx.storage.getUrl(job.fileStorageId),
    ]);
    
    return {
      ...job,
      fileUrl,
    };
  },
});

// Get the oldest pending job for a client
export const getOldestPendingJob = query({
  args: { clientId: v.string(), apiKey: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const expectedApiKey = process.env.API_KEY;
    if (expectedApiKey) {
      if (args.apiKey !== expectedApiKey) {
        throw new Error("Unauthorized");
      }
    } else {
      if (process.env.NODE_ENV !== "test") {
        console.warn("Warning: API_KEY not set; allowing unauthenticated access to getOldestPendingJob.");
      }
    }
    return ctx.db
      .query("printJobs")
      .withIndex("by_clientId", (q) => q.eq("clientId", args.clientId))
      .filter((q) => q.eq(q.field("status"), "pending"))
      .order("asc")
      .first();
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
    return ctx.db.insert("printJobs", {
      ...args,
      status: "pending",
    });
  },
});

// Get a specific job by ID
export const getJob = query({
  args: { jobId: v.id("printJobs") },
  handler: async (ctx, args) => {
    return ctx.db.get(args.jobId);
  },
});

// Get the URL for a file in storage
export const getStorageUrl = query({
  args: { storageId: v.id("_storage"), apiKey: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const expectedApiKey = process.env.API_KEY;
    if (expectedApiKey) {
      if (args.apiKey !== expectedApiKey) {
        throw new Error("Unauthorized");
      }
    } else {
      if (process.env.NODE_ENV !== "test") {
        console.warn("Warning: API_KEY not set; allowing unauthenticated access to getStorageUrl.");
      }
    }
    return ctx.storage.getUrl(args.storageId);
  },
});

// Clean up old jobs and files
export const cleanupOldData = mutation({
  args: {},
  handler: async (ctx) => {
    const maxAgeDays = parseInt(process.env.CLEANUP_MAX_AGE_DAYS || "30");
    const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000; // Convert days to milliseconds
    const cutoffTime = Date.now() - maxAgeMs;

    console.log(`Cleaning up data older than ${maxAgeDays} days (${new Date(cutoffTime).toISOString()})`);

    // Get all old jobs
    const oldJobs = await ctx.db
      .query("printJobs")
      .filter((q) => q.lt(q.field("_creationTime"), cutoffTime))
      .collect();

    console.log(`Found ${oldJobs.length} old jobs to delete`);

    // Collect storage IDs that are no longer referenced
    const storageIdsToDelete = new Set<Id<"_storage">>();

    // Delete old jobs and collect their storage IDs
    for (const job of oldJobs) {
      storageIdsToDelete.add(job.fileStorageId);
      await ctx.db.delete(job._id);
    }

    console.log(`Deleted ${oldJobs.length} old jobs`);

    // Check which storage IDs are still referenced by remaining jobs
    const remainingJobs = await ctx.db.query("printJobs").collect();
    const referencedStorageIds = new Set<Id<"_storage">>(remainingJobs.map(job => job.fileStorageId));

    // Delete storage files that are no longer referenced
    let deletedFilesCount = 0;
    for (const storageId of storageIdsToDelete) {
      if (!referencedStorageIds.has(storageId)) {
        try {
          await ctx.storage.delete(storageId);
          deletedFilesCount++;
        } catch (error) {
          console.error(`Failed to delete storage file ${storageId}:`, error);
        }
      }
    }

    console.log(`Deleted ${deletedFilesCount} unreferenced storage files`);

    return {
      deletedJobs: oldJobs.length,
      deletedFiles: deletedFilesCount,
      cutoffTime: new Date(cutoffTime).toISOString(),
    };
  },
});
