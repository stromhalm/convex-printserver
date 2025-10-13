import { describe, test, expect, vi, beforeEach } from "vitest";
import { handleJob } from "../src/client.js";
import { exec } from "child_process";
import fetch from "node-fetch";

vi.mock("node-fetch");
vi.mock("child_process");

describe("Client Logic", () => {
    const mockClient = {
        mutation: vi.fn(),
        query: vi.fn(),
    };

    const fakeJob = {
        _id: "job123" as any,
        _creationTime: 123,
        clientId: "test-client",
        printerId: "test-printer",
        fileStorageId: "file123" as any,
        cupsOptions: "-o media=A4",
        status: "completed",
        fileUrl: "http://fake-url.com/file.pdf",
    };

    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.clearAllMocks();
    });

    test("handleJob should process a print job in normal mode", async () => {
        const mockBody = {
            pipe: vi.fn(),
        };
        vi.mocked(fetch).mockResolvedValue({
            ok: true,
            body: mockBody,
        } as any);
        
        const mockStdin = {};
        vi.mocked(exec).mockImplementation((_cmd, cb) => {
            (cb as any)(null, "stdout", "");
            return { stdin: mockStdin } as any;
        });

        await handleJob(fakeJob, false);

        expect(fetch).toHaveBeenCalledWith("http://fake-url.com/file.pdf");
        expect(exec).toHaveBeenCalledWith(
            'lp -d "test-printer" -o media=A4',
            expect.any(Function)
        );
        expect(mockBody.pipe).toHaveBeenCalledWith(mockStdin);
        expect(mockClient.mutation).not.toHaveBeenCalled();
    });

    test("handleJob should process a print job in log-only mode", async () => {
        await handleJob(fakeJob, true);

        expect(fetch).not.toHaveBeenCalled();
        expect(exec).not.toHaveBeenCalled();
        expect(mockClient.mutation).not.toHaveBeenCalled();
    });

    test("handleJob should handle print command failure", async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const mockBody = { pipe: vi.fn() };
        vi.mocked(fetch).mockResolvedValue({
            ok: true,
            body: mockBody,
        } as any);
        vi.mocked(exec).mockImplementation((_cmd, cb) => {
            (cb as any)(new Error("Printer on fire"));
            return { stdin: {} } as any;
        });

        await handleJob(fakeJob, false);

        expect(mockClient.mutation).not.toHaveBeenCalled();
    });

    test("handleJob should handle file download failure", async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.mocked(fetch).mockRejectedValue(new Error("Network error"));

        await handleJob(fakeJob, false);

        expect(mockClient.mutation).not.toHaveBeenCalled();
    });
});