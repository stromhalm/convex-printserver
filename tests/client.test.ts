import { describe, test, expect, vi, beforeEach } from "vitest";
import { handleJob } from "../src/client";
import type { Doc } from "../convex/_generated/dataModel";
import { api } from "../convex/_generated/api.js";
import { exec } from "child_process";
import fetch from "node-fetch";
import fs from "fs/promises";
import os from "os";

vi.mock("node-fetch");
vi.mock("child_process");
vi.mock("fs/promises");
vi.mock("os");

describe("Client Logic", () => {
    const mockClient = {
        mutation: vi.fn(),
        query: vi.fn(),
    };

    const fakeJob: Doc<"printJobs"> = {
        _id: "job123" as any,
        _creationTime: 123,
        clientId: "test-client",
        printerId: "test-printer",
        fileStorageId: "file123" as any,
        cupsOptions: "-o media=A4",
        status: "pending",
    };

    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.clearAllMocks();
        mockClient.query.mockResolvedValue("http://fake-url.com/file.pdf");
        vi.mocked(os.tmpdir).mockReturnValue("/tmp");
        vi.mocked(fs.mkdtemp).mockResolvedValue("/tmp/print-123");
    });

    test("handleJob should process a print job in normal mode", async () => {
        vi.mocked(fetch).mockResolvedValue({
            arrayBuffer: () => Promise.resolve(Buffer.from("file content")),
        } as any);
        vi.mocked(exec).mockImplementation((_cmd, cb) => {
            (cb as any)(null, "stdout", "");
            return {} as any;
        });

        await handleJob(fakeJob, mockClient, false);

        expect(mockClient.mutation).toHaveBeenNthCalledWith(1, api.printJobs.updateJobStatus, {
            jobId: "job123",
            status: "processing",
        });
        expect(fetch).toHaveBeenCalledWith("http://fake-url.com/file.pdf");
        expect(fs.writeFile).toHaveBeenCalledWith("/tmp/print-123/job-job123.pdf", Buffer.from("file content"));
        expect(exec).toHaveBeenCalledWith(
            'lp -d "test-printer" -o media=A4 "/tmp/print-123/job-job123.pdf"',
            expect.any(Function)
        );
        expect(mockClient.mutation).toHaveBeenNthCalledWith(2, api.printJobs.updateJobStatus, {
            jobId: "job123",
            status: "completed",
        });
    });

    test("handleJob should process a print job in log-only mode", async () => {
        await handleJob(fakeJob, mockClient, true);

        expect(mockClient.mutation).toHaveBeenNthCalledWith(1, api.printJobs.updateJobStatus, {
            jobId: "job123",
            status: "processing",
        });
        expect(fetch).not.toHaveBeenCalled();
        expect(exec).not.toHaveBeenCalled();
        expect(mockClient.mutation).toHaveBeenNthCalledWith(2, api.printJobs.updateJobStatus, {
            jobId: "job123",
            status: "completed",
        });
    });

    test("handleJob should handle print command failure", async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.mocked(fetch).mockResolvedValue({
            arrayBuffer: () => Promise.resolve(Buffer.from("file content")),
        } as any);
        vi.mocked(exec).mockImplementation((_cmd, cb) => {
            (cb as any)(new Error("Printer on fire"));
            return {} as any;
        });

        await handleJob(fakeJob, mockClient, false);

        expect(mockClient.mutation).toHaveBeenNthCalledWith(2, api.printJobs.updateJobStatus, {
            jobId: "job123",
            status: "failed",
            error: expect.any(String),
        });
    });

    test("handleJob should handle file download failure", async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.mocked(fetch).mockRejectedValue(new Error("Network error"));

        await handleJob(fakeJob, mockClient, false);

        expect(mockClient.mutation).toHaveBeenNthCalledWith(2, api.printJobs.updateJobStatus, {
            jobId: "job123",
            status: "failed",
            error: "Network error",
        });
    });
});