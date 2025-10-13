
import { describe, test, expect, beforeEach, vi } from "vitest";
import { convexTest } from "convex-test";
import { api } from "../convex/_generated/api.js";
import schema from "../convex/schema.js";
import type { Id } from "../convex/_generated/dataModel.js";

describe("Print Job Backend Logic", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
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

  test("getOldestPendingJob should not return non-pending jobs", async () => {
    const t = convexTest(schema);
    const jobId = await t.mutation(api.printJobs.createPrintJob, {
      clientId: "client1",
      printerId: "printer1",
      fileStorageId: fakeFileId,
      cupsOptions: "",
    });

    await t.mutation(api.printJobs.updateJobStatus, { jobId, status: "completed" });

    const job = await t.query(api.printJobs.getOldestPendingJob, { clientId: "client1" });
    expect(job).toBeNull();
  });

  test("should update a job's status", async () => {
    const t = convexTest(schema);
    const jobId = await t.mutation(api.printJobs.createPrintJob, {
      clientId: "client1",
      printerId: "printer1",
      fileStorageId: fakeFileId,
      cupsOptions: "",
    });

    await t.mutation(api.printJobs.updateJobStatus, { 
      jobId, 
      status: "failed", 
      error: "Printer on fire"
    });

    const job = await t.query(api.printJobs.getOldestPendingJob, { clientId: "client1" });
    expect(job).toBeNull(); // No longer pending
  });
});
