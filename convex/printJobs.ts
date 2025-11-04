
import { query, mutation, internalMutation, httpAction } from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel.js";

// Helper function to validate API key
function validateApiKey(providedApiKey: string | undefined) {
  const expectedApiKey = process.env.API_KEY;
  if (expectedApiKey) {
    if (providedApiKey !== expectedApiKey) {
      throw new Error("Unauthorized");
    }
  } else {
    if (process.env.NODE_ENV !== "test") {
      console.warn(`Warning: API_KEY not set; allowing unauthenticated access.`);
    }
  }
}

// Atomically claim a job for a client and return it with file URL
export const claimJob = mutation({
  args: { jobId: v.id("printJobs"), apiKey: v.optional(v.string()) },
  handler: async (ctx, args) => {
    validateApiKey(args.apiKey);
    
    const job = await ctx.db.get(args.jobId);
    
    if (!job) return null;
    
    // Atomically mark as completed and get file URL in parallel
    const [, fileUrl] = await Promise.all([
      ctx.db.patch(job._id, { status: "completed" }),
      ctx.storage.getUrl(job.fileStorageId),
    ]);
    
    return { ...job, status: "completed", fileUrl };
  },
});

// Get the oldest pending job for a client
export const getOldestPendingJob = query({
  args: { clientId: v.string(), apiKey: v.optional(v.string()) },
  handler: async (ctx, args) => {
    validateApiKey(args.apiKey);
    
    return ctx.db
      .query("printJobs")
      .withIndex("by_clientId_status", (q) => 
        q.eq("clientId", args.clientId).eq("status", "pending")
      )
      .order("asc")
      .first();
  },
});

// Create a new print job (internal only - called from HTTP action)
export const createPrintJob = internalMutation({
  args: {
    clientId: v.string(),
    printerId: v.string(),
    fileStorageId: v.id("_storage"),
    cupsOptions: v.string(),
    context: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return ctx.db.insert("printJobs", { ...args, status: "pending" });
  },
});

// Clean up old jobs and files (processes in batches to avoid document read limits)
export const cleanupOldData = internalMutation({
  args: {},
  handler: async (ctx) => {
    const maxAgeDays = parseInt(process.env.CLEANUP_MAX_AGE_DAYS || "30");
    const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000; // Convert days to milliseconds
    const cutoffTime = Date.now() - maxAgeMs;
    
    // Process in batches to stay well under the 32k document read limit
    const BATCH_SIZE = 1000;

    console.log(`Cleaning up data older than ${maxAgeDays} days (${new Date(cutoffTime).toISOString()})`);

    // Get a batch of old jobs
    // We query all jobs and filter by creation time, then take a batch
    // This is efficient because we use .take() to limit document reads per transaction
    const oldJobs = await ctx.db
      .query("printJobs")
      .filter((q) => q.lt(q.field("_creationTime"), cutoffTime))
      .take(BATCH_SIZE);

    console.log(`Found ${oldJobs.length} old jobs in this batch`);

    if (oldJobs.length === 0) {
      console.log("No old jobs to clean up");
      return {
        deletedJobs: 0,
        deletedFiles: 0,
        cutoffTime: new Date(cutoffTime).toISOString(),
        hasMore: false,
      };
    }

    // Collect storage IDs that might need deletion
    const storageIdsToCheck = new Set<Id<"_storage">>();

    // Delete old jobs and collect their storage IDs
    for (const job of oldJobs) {
      storageIdsToCheck.add(job.fileStorageId);
      await ctx.db.delete(job._id);
    }

    console.log(`Deleted ${oldJobs.length} old jobs`);

    // For each storage ID, check if it's still referenced by any job
    let deletedFilesCount = 0;
    for (const storageId of storageIdsToCheck) {
      const stillReferenced = await ctx.db
        .query("printJobs")
        .filter((q) => q.eq(q.field("fileStorageId"), storageId))
        .first();
      
      if (!stillReferenced) {
        try {
          await ctx.storage.delete(storageId);
          deletedFilesCount++;
        } catch (error) {
          console.error(`Failed to delete storage file ${storageId}:`, error);
        }
      }
    }

    console.log(`Deleted ${deletedFilesCount} unreferenced storage files`);

    // Check if there are more jobs to clean up
    const hasMore = oldJobs.length === BATCH_SIZE;
    
    if (hasMore) {
      console.log("More jobs to clean up, scheduling next batch...");
      // Schedule the next batch to run immediately
      await ctx.scheduler.runAfter(0, internal.printJobs.cleanupOldData, {});
    }

    return {
      deletedJobs: oldJobs.length,
      deletedFiles: deletedFilesCount,
      cutoffTime: new Date(cutoffTime).toISOString(),
      hasMore,
    };
  },
});


export const printAction = httpAction(async (ctx, request) => {
  const providedApiKey = request.headers.get("x-api-key") ?? undefined;
  
  try {
    validateApiKey(providedApiKey);
  } catch (error) {
    return new Response("Unauthorized", { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  const clientId = formData.get("clientId") as string;
  const printerId = formData.get("printerId") as string;
  const cupsOptions = formData.get("cupsOptions") as string;
  const context = formData.get("context") as string;

  if (!(file instanceof File)) {
    return new Response("No file uploaded", { status: 400 });
  }

  const fileStorageId = await ctx.storage.store(file);

  await ctx.runMutation(internal.printJobs.createPrintJob, {
    clientId,
    printerId,
    fileStorageId,
    cupsOptions,
    ...(context && { context }),
  });

  return new Response("Print job created");
});
