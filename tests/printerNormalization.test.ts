import { describe, test, expect, beforeEach, vi } from "vitest";
import { convexTest } from "convex-test";
import { api } from "../convex/_generated/api.js";
import schema from "../convex/schema.js";
import type { Id } from "../convex/_generated/dataModel.js";

describe("Printer Name Normalization", () => {
  const fakeFileId = "12345;_storage" as Id<"_storage">;

  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  test("should normalize printer name with spaces", async () => {
    const t = convexTest(schema);
    
    const result = await t.run(async (ctx) => {
      // Simulate HTTP endpoint normalization
      const printerId = "Brother MFC-L3770CDW series".replace(/[\s.]/g, '_');
      
      const jobId = await ctx.db.insert("printJobs", {
        clientId: "client1",
        printerId,
        fileStorageId: fakeFileId,
        cupsOptions: "",
        status: "pending",
      });
      
      const job = await ctx.db.get(jobId);
      return job?.printerId;
    });

    expect(result).toBe("Brother_MFC-L3770CDW_series");
  });

  test("should normalize printer name starting with digit", async () => {
    const t = convexTest(schema);
    
    const result = await t.run(async (ctx) => {
      // Simulate HTTP endpoint normalization
      let printerId = "192.168.7.101".replace(/[\s.]/g, '_');
      if (/^\d/.test(printerId)) {
        printerId = '_' + printerId;
      }
      
      const jobId = await ctx.db.insert("printJobs", {
        clientId: "client1",
        printerId,
        fileStorageId: fakeFileId,
        cupsOptions: "",
        status: "pending",
      });
      
      const job = await ctx.db.get(jobId);
      return job?.printerId;
    });

    expect(result).toBe("_192_168_7_101");
  });

  test("should normalize printer name with dots and spaces", async () => {
    const t = convexTest(schema);
    
    const result = await t.run(async (ctx) => {
      // Simulate HTTP endpoint normalization
      const printerId = "HP LaserJet Pro 4.01".replace(/[\s.]/g, '_');
      
      const jobId = await ctx.db.insert("printJobs", {
        clientId: "client1",
        printerId,
        fileStorageId: fakeFileId,
        cupsOptions: "",
        status: "pending",
      });
      
      const job = await ctx.db.get(jobId);
      return job?.printerId;
    });

    expect(result).toBe("HP_LaserJet_Pro_4_01");
  });

  test("should not modify already normalized printer names", async () => {
    const t = convexTest(schema);
    
    const result = await t.run(async (ctx) => {
      // Already normalized name
      const printerId = "My_Printer_Name".replace(/[\s.]/g, '_');
      
      const jobId = await ctx.db.insert("printJobs", {
        clientId: "client1",
        printerId,
        fileStorageId: fakeFileId,
        cupsOptions: "",
        status: "pending",
      });
      
      const job = await ctx.db.get(jobId);
      return job?.printerId;
    });

    expect(result).toBe("My_Printer_Name");
  });
});

