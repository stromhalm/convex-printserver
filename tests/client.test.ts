import { describe, test, expect, vi, beforeEach } from "vitest";
import { handleJob } from "../src/client.js";
import { exec } from "child_process";
import fetch from "node-fetch";

vi.mock("node-fetch");
vi.mock("child_process");

describe("Client Logic", () => {
    const fakeJob = {
        _id: "job123" as any,
        _creationTime: 123,
        clientId: "test-client",
        printerId: "test-printer",
        fileStorageId: "file123" as any,
        cupsOptions: "-o media=A4",
        status: "printing",
        attempts: 1,
        fileUrl: "http://fake-url.com/file.pdf",
    };

    const fileContent = Buffer.from("%PDF-fake");

    function mockDownload() {
        vi.mocked(fetch).mockResolvedValue({
            ok: true,
            buffer: vi.fn().mockResolvedValue(fileContent),
        } as any);
    }

    function mockStdin() {
        return {
            on: vi.fn().mockReturnThis(),
            end: vi.fn(),
        };
    }

    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    test("handleJob should process a print job in normal mode", async () => {
        mockDownload();
        const stdin = mockStdin();
        vi.mocked(exec).mockImplementation(((_cmd: string, _opts: any, cb: any) => {
            cb(null, "stdout", "");
            return { stdin } as any;
        }) as any);

        await handleJob(fakeJob, false);

        expect(fetch).toHaveBeenCalledWith(
            "http://fake-url.com/file.pdf",
            expect.objectContaining({ signal: expect.anything() })
        );
        expect(exec).toHaveBeenCalledWith(
            'lp -d "test_printer" -o media=A4',
            expect.objectContaining({ timeout: expect.any(Number) }),
            expect.any(Function)
        );
        expect(stdin.on).toHaveBeenCalledWith('error', expect.any(Function));
        expect(stdin.end).toHaveBeenCalledWith(fileContent);
    });

    test("handleJob should process a print job in log-only mode", async () => {
        await handleJob(fakeJob, true);

        expect(fetch).not.toHaveBeenCalled();
        expect(exec).not.toHaveBeenCalled();
    });

    test("handleJob should throw on print command failure", async () => {
        mockDownload();
        vi.mocked(exec).mockImplementation(((_cmd: string, _opts: any, cb: any) => {
            cb(new Error("Printer on fire"));
            return { stdin: mockStdin() } as any;
        }) as any);

        await expect(handleJob(fakeJob, false)).rejects.toThrowError(/Printer on fire/);
    });

    test("handleJob should throw when the print command times out", async () => {
        mockDownload();
        vi.mocked(exec).mockImplementation(((_cmd: string, _opts: any, cb: any) => {
            cb(Object.assign(new Error("Command failed"), { killed: true }));
            return { stdin: mockStdin() } as any;
        }) as any);

        await expect(handleJob(fakeJob, false)).rejects.toThrowError(/timed out/);
    });

    test("handleJob should throw on file download failure without printing", async () => {
        vi.mocked(fetch).mockRejectedValue(new Error("Network error"));

        await expect(handleJob(fakeJob, false)).rejects.toThrowError(/Network error/);
        expect(exec).not.toHaveBeenCalled();
    });

    test("handleJob should register a missing printer and retry", async () => {
        mockDownload();
        let printCalls = 0;
        vi.mocked(exec).mockImplementation(((cmd: string, _opts: any, cb: any) => {
            if (cmd.startsWith("lp ") && printCalls++ === 0) {
                cb(new Error("lp: No such file or directory"));
            } else {
                cb(null, "", "");
            }
            return { stdin: mockStdin() } as any;
        }) as any);

        await handleJob(fakeJob, false);

        expect(exec).toHaveBeenCalledTimes(3);
        expect(vi.mocked(exec).mock.calls[1][0]).toMatch(/^lpadmin -p test_printer/);
    });
});
