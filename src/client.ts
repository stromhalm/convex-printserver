
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { ConvexClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import type { Doc } from "../convex/_generated/dataModel.js";
import "dotenv/config";
import { exec } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";
import fetch from "node-fetch";

let isProcessing = false;
let startupProcessing = false;

async function main() {
  const argv = await yargs(hideBin(process.argv))
    .demandCommand(1)
    .usage("Usage: node client <clientId> [--log]")
    .options({ log: { type: "boolean", default: false } }).argv;

  const [clientId] = argv._;
  const { log: logOnly } = argv;

  if (typeof clientId !== "string") {
    console.error("Error: clientId must be a string.");
    process.exit(1);
  }

  const convexUrl = process.env.CONVEX_URL;
  if (!convexUrl) {
    console.error("Error: CONVEX_URL environment variable not set.");
    console.error("Run `npx convex dev` in a separate terminal.");
    process.exit(1);
  }

  const client = new ConvexClient(convexUrl);

  console.log(`Client "${clientId}" started. Waiting for print jobs...`);
  if (logOnly) {
    console.log("Operating in log-only mode. Jobs will not be printed.");
  }

  client.onUpdate(api.printJobs.getOldestPendingJob, { clientId: clientId as string }, (job) => {
    if (job && !isProcessing && !startupProcessing) {
      isProcessing = true;
      handleJob(job).finally(() => {
        isProcessing = false;
      });
    }
  });

  // Check for any pending jobs on startup and process them all
  processAllPendingJobs();

  async function processAllPendingJobs() {
    startupProcessing = true;
    try {
      while (!isProcessing) {
        const job = await client.query(api.printJobs.getOldestPendingJob, { clientId: clientId as string });
        if (!job) break; // No more pending jobs

        isProcessing = true;
        await handleJob(job);
        isProcessing = false;

        // Brief pause before checking for next job
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    } catch (error) {
      console.error("Error processing pending jobs:", error);
    } finally {
      startupProcessing = false;
    }
  }

  async function handleJob(job: Doc<"printJobs">) {
    console.log(`\n--- Processing Job [${job._id}] ---`);
    try {
      // Mark job as processing
      await client.mutation(api.printJobs.updateJobStatus, {
        jobId: job._id,
        status: "processing",
      });

      const fileUrl = await client.query(api.printJobs.getStorageUrl, { storageId: job.fileStorageId });
      if (!fileUrl) {
        throw new Error(`Failed to get file URL for ${job.fileStorageId}`);
      }

      if (logOnly) {
        console.log(`  Client: ${job.clientId}`);
        console.log(`  Printer: ${job.printerId}`);
        console.log(`  File URL: ${fileUrl}`);
        console.log(`  CUPS Options: ${job.cupsOptions}`);
        await client.mutation(api.printJobs.updateJobStatus, {
          jobId: job._id,
          status: "completed",
        });
        console.log(`--- Job [${job._id}] Logged ---`);
        return;
      }

      // Download file to a temporary location
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "print-"));
      const tempFilePath = path.join(tempDir, `job-${job._id}.pdf`);
      const response = await fetch(fileUrl);
      const buffer = await response.arrayBuffer();
      await fs.writeFile(tempFilePath, Buffer.from(buffer));

      console.log(`  File downloaded to: ${tempFilePath}`);

      // Print the file
      const printCommand = `lp -d "${job.printerId}" ${job.cupsOptions} "${tempFilePath}"`;
      console.log(`  Executing: ${printCommand}`);

      await new Promise<void>((resolve, reject) => {
        exec(printCommand, (error, stdout, stderr) => {
          if (error) {
            console.error(`Print command failed: ${error.message}`);
            if (stderr) console.error(`Stderr: ${stderr}`);
            reject(error);
            return;
          }
          if (stdout) console.log(`Stdout: ${stdout}`);
          resolve();
        });
      });

      // Mark job as completed
      await client.mutation(api.printJobs.updateJobStatus, {
        jobId: job._id,
        status: "completed",
      });
      console.log(`--- Job [${job._id}] Completed ---`);

      // Cleanup
      await fs.rm(tempDir, { recursive: true, force: true });

    } catch (error: any) {
      console.error(`Failed to process job ${job._id}:`, error);
      await client.mutation(api.printJobs.updateJobStatus, {
        jobId: job._id,
        status: "failed",
        error: error.message,
      });
      console.log(`--- Job [${job._id}] Failed ---`);
    }
  }
}

main().catch(console.error);
