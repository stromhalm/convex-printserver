
import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import { api } from "../convex/_generated/api.js";
import schema from "../convex/schema.js";
import type { Id } from "../convex/_generated/dataModel.js";

describe("Print Job Backend Logic", () => {
  let prevApiKey: string | undefined;
  beforeEach(() => {
    prevApiKey = process.env.API_KEY;
    delete process.env.API_KEY;
  });
  afterEach(() => {
    if (prevApiKey === undefined) {
      delete process.env.API_KEY;
    } else {
      process.env.API_KEY = prevApiKey;
    }
  });
  // A fake storage ID that passes the validator in convex-test
  const fakeFileId = "12345;_storage" as Id<"_storage">;

  test("should create a print job", async () => {
    const t = convexTest(schema);
    await t.mutation(api.printJobs.createPrintJob, {
      clientId: "client1",
      printerId: "printer1",
      fileStorageId: fakeFileId,
      cupsOptions: "-o media=A4",
    });

    const job = await t.query(api.printJobs.getOldestPendingJob, { clientId: "client1" });
    expect(job).not.toBeNull();
    expect(job?.clientId).toBe("client1");
    expect(job?.status).toBe("pending");
  });

  test("getOldestPendingJob should return null if no jobs exist", async () => {
    const t = convexTest(schema);
    const job = await t.query(api.printJobs.getOldestPendingJob, { clientId: "client1" });
    expect(job).toBeNull();
  });

  test("getOldestPendingJob should return the oldest job", async () => {
    const t = convexTest(schema);

    const job1Id = await t.mutation(api.printJobs.createPrintJob, {
      clientId: "client1",
      printerId: "printer1",
      fileStorageId: fakeFileId,
      cupsOptions: "",
    });

    await t.mutation(api.printJobs.createPrintJob, {
      clientId: "client1",
      printerId: "printer2",
      fileStorageId: fakeFileId,
      cupsOptions: "",
    });

    const oldestJob = await t.query(api.printJobs.getOldestPendingJob, { clientId: "client1" });
    expect(oldestJob).not.toBeNull();
    expect(oldestJob!._id).toEqual(job1Id);
  });

  test("getOldestPendingJob should not return jobs for other clients", async () => {
    const t = convexTest(schema);
    await t.mutation(api.printJobs.createPrintJob, {
      clientId: "client2",
      printerId: "printer1",
      fileStorageId: fakeFileId,
      cupsOptions: "",
    });

    const job = await t.query(api.printJobs.getOldestPendingJob, { clientId: "client1" });
    expect(job).toBeNull();
  });

  test("claimJob should mark job as completed and return with URL", async () => {
    const t = convexTest(schema);
    const jobId = await t.mutation(api.printJobs.createPrintJob, {
      clientId: "client1",
      printerId: "printer1",
      fileStorageId: fakeFileId,
      cupsOptions: "",
    });

    const claimedJob = await t.mutation(api.printJobs.claimJob, { jobId });
    expect(claimedJob).not.toBeNull();
    expect(claimedJob?._id).toEqual(jobId);
    expect(claimedJob?.fileUrl).toBeDefined();

    // Job should be marked as completed in DB
    const updatedJob = await t.query(api.printJobs.getJob, { jobId });
    expect(updatedJob?.status).toBe("completed");

    // Should not return the same job again as pending
    const nextJob = await t.query(api.printJobs.getOldestPendingJob, { clientId: "client1" });
    expect(nextJob).toBeNull();
  });

  test("should process multiple pending jobs in order", async () => {
    const t = convexTest(schema);
    
    // Create 3 jobs
    const jobId1 = await t.mutation(api.printJobs.createPrintJob, {
      clientId: "client1",
      printerId: "printer1",
      fileStorageId: fakeFileId,
      cupsOptions: "",
    });

    const jobId2 = await t.mutation(api.printJobs.createPrintJob, {
      clientId: "client1",
      printerId: "printer1",
      fileStorageId: fakeFileId,
      cupsOptions: "",
    });

    const jobId3 = await t.mutation(api.printJobs.createPrintJob, {
      clientId: "client1",
      printerId: "printer1",
      fileStorageId: fakeFileId,
      cupsOptions: "",
    });

    // Claim first job
    const job1 = await t.mutation(api.printJobs.claimJob, { jobId: jobId1 });
    expect(job1?._id).toEqual(jobId1);

    // Second job should now be oldest pending
    let oldestJob = await t.query(api.printJobs.getOldestPendingJob, { clientId: "client1" });
    expect(oldestJob?._id).toEqual(jobId2);

    // Claim second job
    const job2 = await t.mutation(api.printJobs.claimJob, { jobId: jobId2 });
    expect(job2?._id).toEqual(jobId2);

    // Third job should now be oldest pending
    oldestJob = await t.query(api.printJobs.getOldestPendingJob, { clientId: "client1" });
    expect(oldestJob?._id).toEqual(jobId3);

    // Claim third job
    const job3 = await t.mutation(api.printJobs.claimJob, { jobId: jobId3 });
    expect(job3?._id).toEqual(jobId3);

    // No more pending jobs
    oldestJob = await t.query(api.printJobs.getOldestPendingJob, { clientId: "client1" });
    expect(oldestJob).toBeNull();
  });
});
