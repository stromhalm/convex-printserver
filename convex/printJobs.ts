
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

// Number of print attempts before a job is marked as "failed"
const MAX_ATTEMPTS = 3;

function statusAfterFailure(attempts: number | undefined) {
  return (attempts ?? 1) >= MAX_ATTEMPTS ? "failed" : "pending";
}

// Atomically claim a pending job for printing and return it with file URL.
// Clients passing reportsResult must report the outcome via completeJob or failJob.
// Legacy clients (without reportsResult) get the job marked as completed right away.
export const claimJob = mutation({
  args: {
    jobId: v.id("printJobs"),
    apiKey: v.optional(v.string()),
    reportsResult: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    validateApiKey(args.apiKey);
    
    const job = await ctx.db.get(args.jobId);
    
    // Only pending jobs can be claimed (prevents double printing of stale job IDs)
    if (!job || job.status !== "pending") return null;
    
    const status = args.reportsResult ? "printing" : "completed";
    const attempts = (job.attempts ?? 0) + 1;
    const [, fileUrl] = await Promise.all([
      ctx.db.patch(job._id, { status, attempts }),
      ctx.storage.getUrl(job.fileStorageId),
    ]);
    
    return { ...job, status, attempts, fileUrl };
  },
});

// Mark a claimed job as successfully printed
export const completeJob = mutation({
  args: { jobId: v.id("printJobs"), apiKey: v.optional(v.string()) },
  handler: async (ctx, args) => {
    validateApiKey(args.apiKey);

    const job = await ctx.db.get(args.jobId);
    if (!job || job.status !== "printing") return;

    await ctx.db.patch(job._id, { status: "completed" });
  },
});

// Report a failed print attempt: requeue the job or give up after MAX_ATTEMPTS
export const failJob = mutation({
  args: { jobId: v.id("printJobs"), error: v.string(), apiKey: v.optional(v.string()) },
  handler: async (ctx, args) => {
    validateApiKey(args.apiKey);

    const job = await ctx.db.get(args.jobId);
    if (!job || job.status !== "printing") return;

    await ctx.db.patch(job._id, { status: statusAfterFailure(job.attempts), lastError: args.error });
  },
});

// Requeue jobs left in "printing" state by a client that was terminated mid-job.
// Called by the client on startup, when it cannot have any jobs in progress.
export const releaseClaimedJobs = mutation({
  args: { clientId: v.string(), apiKey: v.optional(v.string()) },
  handler: async (ctx, args) => {
    validateApiKey(args.apiKey);

    const jobs = await ctx.db
      .query("printJobs")
      .withIndex("by_clientId_status", (q) =>
        q.eq("clientId", args.clientId).eq("status", "printing")
      )
      .take(100);

    for (const job of jobs) {
      await ctx.db.patch(job._id, { status: statusAfterFailure(job.attempts) });
    }

    return jobs.length;
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
    const BATCH_SIZE = 500;

    console.log(`Cleaning up data older than ${maxAgeDays} days (${new Date(cutoffTime).toISOString()})`);

    // Get oldest jobs using the index (which includes _creationTime)
    // Query in ascending order by creation time
    const jobs = await ctx.db
      .query("printJobs")
      .order("asc")
      .take(BATCH_SIZE);

    // Filter to only include jobs older than cutoff
    const oldJobs = jobs.filter(job => job._creationTime < cutoffTime);

    console.log(`Found ${oldJobs.length} old jobs in this batch (checked ${jobs.length} total)`);

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

    // For each storage ID, check if it's still referenced by any job using the index
    let deletedFilesCount = 0;
    for (const storageId of storageIdsToCheck) {
      const stillReferenced = await ctx.db
        .query("printJobs")
        .withIndex("by_fileStorageId", (q) => q.eq("fileStorageId", storageId))
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

    // Continue if we deleted any jobs (there might be more old ones)
    const hasMore = oldJobs.length > 0;
    
    if (hasMore) {
      console.log("Scheduling next cleanup batch...");
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
