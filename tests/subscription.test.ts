// @vitest-environment node
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { ConvexClient } from "convex/browser";
import { main } from "../src/client.js";

vi.mock("convex/browser", () => ({ ConvexClient: vi.fn() }));

describe("Pending job subscription", () => {
    const subscriptions: { onError?: (e: Error) => void; unsubscribe: ReturnType<typeof vi.fn> }[] = [];
    const originalArgv = process.argv;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
        subscriptions.length = 0;
        process.argv = ["node", "client.ts", "test-client"];
        process.env.CONVEX_URL = "https://example.convex.cloud";

        vi.mocked(ConvexClient).mockImplementation(() => ({
            mutation: vi.fn().mockResolvedValue(0),
            query: vi.fn().mockResolvedValue(null),
            onUpdate: vi.fn((_query, _args, _callback, onError) => {
                const unsubscribe = vi.fn();
                subscriptions.push({ onError, unsubscribe });
                return unsubscribe;
            }),
        }) as any);
    });

    afterEach(() => {
        vi.useRealTimers();
        process.argv = originalArgv;
    });

    test("resubscribes after a query error instead of staying stuck", async () => {
        await main();
        expect(subscriptions).toHaveLength(1);

        subscriptions[0].onError!(new Error("[CONVEX Q(printJobs:getOldestPendingJob)] Server Error"));
        expect(subscriptions[0].unsubscribe).toHaveBeenCalled();
        expect(subscriptions).toHaveLength(1);

        await vi.advanceTimersByTimeAsync(5_000);
        expect(subscriptions).toHaveLength(2);
    });
});
