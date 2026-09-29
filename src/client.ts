import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { ConvexClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import "dotenv/config";
import { exec } from "child_process";
import fetch from "node-fetch";
import { fileURLToPath } from "url";

let isProcessing = false;

function findDriver(protocol: string, host: string): string | null {
  const printerIdentifier = `${protocol}://${host}`;
  for (const key in process.env) {
    if (key.startsWith("PRINTER_DRIVER_")) {
      const value = process.env[key]!;
      const parts = value.split(':');
      if (parts.length < 2) continue;

      const pattern = parts[0] + ":" + parts[1];
      const driverPath = parts.slice(2).join(':');

      const regex = new RegExp(`^${pattern.replace(/\*/g, '.*')}$`);
      if (regex.test(printerIdentifier)) {
        return driverPath;
      }
    }
  }
  return null;
}


export function normalizePrinterName(host: string) {
  // Replace any characters that are not letters, numbers, or underscores with an underscore
  // Also, ensure the name starts with a letter or underscore
  const normalized = host.replace(/[^a-zA-Z0-9_]/g, '_');
  if (!/^[a-zA-Z_]/.test(normalized)) {
    return `_${normalized}`;
  }
  return normalized;
}

// Timeouts prevent a stalled download or print command from blocking the job queue
const DOWNLOAD_TIMEOUT_MS = 30_000;
const COMMAND_TIMEOUT_MS = 60_000;
// Pause after a failed job before the next attempt (e.g. to ride out network glitches)
const RETRY_DELAY_MS = 5_000;

function runCommand(command: string, input?: Buffer) {
  return new Promise<void>((resolve, reject) => {
    const child = exec(command, { timeout: COMMAND_TIMEOUT_MS }, (error, stdout, stderr) => {
      if (error) {
        const reason = error.killed ? `timed out after ${COMMAND_TIMEOUT_MS}ms` : error.message;
        console.error(`Command failed: ${reason}`);
        if (stderr) console.error(`Stderr: ${stderr}`);
        reject(error.killed ? new Error(`Command ${reason}: ${command}`) : error);
        return;
      }
      if (stdout) console.log(`Stdout: ${stdout}`);
      resolve();
    });

    if (input === undefined) return;
    if (!child.stdin) {
      reject(new Error("Failed to pipe file to print command"));
      return;
    }
    child.stdin.on('error', (err) => {
      // Ignore EPIPE errors on stdin - they occur when lp closes early
      if (err.message.includes('EPIPE')) {
        console.warn(`Print command closed stdin early (this may be normal): ${err.message}`);
      } else {
        console.error(`Stdin error: ${err.message}`);
        reject(err);
      }
    });
    child.stdin.end(input);
  });
}

async function downloadFile(url: string) {
  // The signal also aborts a stalled body download, not just the initial request
  const response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`Failed to download file: ${response.status} ${response.statusText}`);
  }
  return response.buffer();
}

// Prints a job and throws if it could not be printed
export async function handleJob(job: any, logOnly: boolean) {
    const receivedAt = new Date().toISOString();
    console.log(`\n--- Processing Job [${job._id}] (received ${receivedAt}, attempt ${job.attempts ?? 1}) ---`);
    try {
      if (!job.fileUrl) {
        throw new Error(`No file URL provided for job ${job._id}`);
      }

      if (logOnly) {
        console.log(`  Client: ${job.clientId}`);
        console.log(`  Printer: ${job.printerId}`);
        console.log(`  File URL: ${job.fileUrl}`);
        console.log(`  CUPS Options: ${job.cupsOptions}`);
        console.log(`--- Job [${job._id}] Completed ---`);
        return;
      }

      const printerId = job.printerId;
      let protocol = 'ipp';
      let host = printerId;

      const protocolMatch = printerId.match(/^([a-zA-Z]+):\/\/(.+)/);
      if (protocolMatch) {
        protocol = protocolMatch[1];
        host = protocolMatch[2];
      } else {
        const lastSlashIndex = printerId.lastIndexOf("/");
        if (lastSlashIndex !== -1) {
          protocol = printerId.substring(lastSlashIndex + 1);
          host = printerId.substring(0, lastSlashIndex);
        }
      }

      const printerName = normalizePrinterName(host);

      // Download completely before printing, so a stalled download never leaves lp waiting for input
      const file = await downloadFile(job.fileUrl);

      let printCommand = `lp -d "${printerName}"`;
      if (job.cupsOptions) {
        printCommand += ` ${job.cupsOptions}`;
      }
      console.log(`  Executing: ${printCommand}`);

      try {
        await runCommand(printCommand, file);
      } catch (error: any) {
        if (!error.message.includes("lp: No such file or directory")) {
          throw error;
        }

        console.log("Printer not found, attempting to register...");
        let registerCommand = `lpadmin -p ${printerName} -E -v "${protocol}://${host}"`;

        const driverPath = findDriver(protocol, host);
        if (driverPath) {
          registerCommand += ` -P "${driverPath}"`;
        } else if (protocol === 'ipp') {
          registerCommand += ` -m everywhere`;
        }

        console.log(`  Executing: ${registerCommand}`);
        await runCommand(registerCommand);
        console.log("Printer registered, retrying print job...");
        await runCommand(printCommand, file);
      }

      console.log(`--- Job [${job._id}] Completed ---`);

    } catch (error: any) {
      console.error(`Failed to process job ${job._id}:`, error);
      console.log(`--- Job [${job._id}] Failed ---`);
      throw error;
    }
  }

export async function main() {
  const {clientId, log: logOnlyRaw} = await yargs(hideBin(process.argv))
    .command('$0 <clientId>', 'Starts the print client.', (yargs) => {
      return yargs
        .positional('clientId', {
          describe: 'The ID of the print client',
          type: 'string',
        })
        .option('log', {
          describe: 'Log jobs to the console instead of printing',
          type: 'boolean',
          default: false,
        });
    })
    .demandCommand(1, 'You must provide a client ID.')
    .help()
    .argv;

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

  const logOnly = Boolean(logOnlyRaw);
  console.log(`Client "${clientId}" started. Waiting for print jobs...`);
  if (logOnly) {
    console.log("Operating in log-only mode. Jobs will not be printed.");
  }

  const apiKey = process.env.API_KEY;

  // Claim a job, print it and report the result back to Convex
  async function processJob(jobId: any) {
    const job = await client.mutation(api.printJobs.claimJob, { jobId, apiKey, reportsResult: true });
    if (!job) return; // Already claimed or no longer pending

    try {
      await handleJob(job, logOnly);
    } catch (error: any) {
      await client.mutation(api.printJobs.failJob, {
        jobId: job._id,
        error: String(error?.message ?? error),
        apiKey,
      });
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      return;
    }
    await client.mutation(api.printJobs.completeJob, { jobId: job._id, apiKey });
  }

  // Work through all pending jobs, one at a time
  async function processPendingJobs(firstJobId: any) {
    if (isProcessing) return;

    isProcessing = true;
    try {
      let jobId = firstJobId;
      while (jobId) {
        try {
          await processJob(jobId);
        } catch (error) {
          console.error("Error claiming/processing job:", error);
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        }
        const nextJob = await client.query(api.printJobs.getOldestPendingJob, { clientId: clientId as string, apiKey });
        jobId = nextJob?._id;
      }
    } catch (error) {
      // The subscription won't fire again for an unchanged result, so retry on our own
      console.error(`Error fetching next pending job, retrying in ${RETRY_DELAY_MS}ms:`, error);
      setTimeout(() => {
        client.query(api.printJobs.getOldestPendingJob, { clientId: clientId as string, apiKey })
          .then((job) => job && processPendingJobs(job._id))
          .catch((error) => console.error("Error fetching next pending job:", error));
      }, RETRY_DELAY_MS);
    } finally {
      isProcessing = false;
    }
  }

  // Keep running on unexpected errors instead of crashing the print server
  process.on('unhandledRejection', (error) => {
    console.error("Unhandled rejection:", error);
  });

  // Jobs still marked as printing belong to a previous run of this client that was terminated mid-job
  try {
    const released = await client.mutation(api.printJobs.releaseClaimedJobs, { clientId, apiKey });
    if (released > 0) {
      console.log(`Requeued ${released} job(s) interrupted by a previous run.`);
    }
  } catch (error) {
    console.error("Error requeuing interrupted jobs:", error);
  }

  // Use reactive subscription to watch for pending jobs (handles both startup and incoming)
  client.onUpdate(api.printJobs.getOldestPendingJob, { clientId, apiKey }, (pendingJob) => {
    if (pendingJob && !isProcessing) {
      processPendingJobs(pendingJob._id);
    }
  });
}

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);
if (isMainModule) {
  main();
}