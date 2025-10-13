import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import { api } from "../convex/_generated/api.js";
import schema from "../convex/schema.js";
import type { Id } from "../convex/_generated/dataModel.js";

describe("API Key Enforcement", () => {
  const fakeFileId = "12345;_storage" as Id<"_storage">;

  

  let prevApiKey: string | undefined;
  beforeEach(() => {
    prevApiKey = process.env.API_KEY;
    process.env.API_KEY = "secret";
  });
  afterEach(() => {
    if (prevApiKey === undefined) {
      delete process.env.API_KEY;
    } else {
      process.env.API_KEY = prevApiKey;
    }
  });

  test("queries/mutations reject when API_KEY is set and wrong key provided", async () => {
    const t = convexTest(schema);

    await expect(
      t.query(api.printJobs.getOldestPendingJob, { clientId: "c1", apiKey: "wrong" })
    ).rejects.toThrowError(/Unauthorized/);

    const jobId = await t.mutation(api.printJobs.createPrintJob, {
      clientId: "c1",
      printerId: "p1",
      fileStorageId: fakeFileId,
      cupsOptions: "",
    });

    await expect(
      t.query(api.printJobs.getStorageUrl, { storageId: fakeFileId, apiKey: "wrong" })
    ).rejects.toThrowError(/Unauthorized/);

    await expect(
      t.mutation(api.printJobs.claimJob, { jobId, apiKey: "wrong" })
    ).rejects.toThrowError(/Unauthorized/);
  });

  test("queries/mutations succeed when API_KEY is set and correct key provided", async () => {
    const t = convexTest(schema);

    const jobId = await t.mutation(api.printJobs.createPrintJob, {
      clientId: "c1",
      printerId: "p1",
      fileStorageId: fakeFileId,
      cupsOptions: "",
    });

    const job = await t.query(api.printJobs.getOldestPendingJob, { clientId: "c1", apiKey: "secret" });
    expect(job?._id).toEqual(jobId);

    const url = await t.query(api.printJobs.getStorageUrl, { storageId: fakeFileId, apiKey: "secret" });
    expect(typeof url === "string" || url === null).toBe(true);

    const claimedJob = await t.mutation(api.printJobs.claimJob, { jobId, apiKey: "secret" });
    expect(claimedJob?._id).toEqual(jobId);
    expect(claimedJob?.fileUrl).toBeDefined();
    
    const none = await t.query(api.printJobs.getOldestPendingJob, { clientId: "c1", apiKey: "secret" });
    expect(none).toBeNull();
  });
});


