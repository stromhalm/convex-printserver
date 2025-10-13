import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { ConvexClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import "dotenv/config";
import { exec } from "child_process";
import fetch from "node-fetch";
import { fileURLToPath } from "url";

let isProcessing = false;

export async function handleJob(job: any, client: any, logOnly: boolean) {
    console.log(`\n--- Processing Job [${job._id}] ---`);
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

      // Stream file directly to printer via stdin (no temp file needed)
      let printCommand = `lp -d "${job.printerId}"`;
      if (job.cupsOptions) {
        printCommand += ` ${job.cupsOptions}`;
      }
      console.log(`  Executing: ${printCommand}`);

      const response = await fetch(job.fileUrl);
      if (!response.ok) {
        throw new Error(`Failed to download file: ${response.status} ${response.statusText}`);
      }

      await new Promise<void>((resolve, reject) => {
        const child = exec(printCommand, (error, stdout, stderr) => {
          if (error) {
            console.error(`Print command failed: ${error.message}`);
            if (stderr) console.error(`Stderr: ${stderr}`);
            reject(error);
            return;
          }
          if (stdout) console.log(`Stdout: ${stdout}`);
          resolve();
        });

        // Stream response directly to lp stdin
        if (child.stdin && response.body) {
          response.body.pipe(child.stdin);
        } else {
          reject(new Error("Failed to pipe file to print command"));
        }
      });

      console.log(`--- Job [${job._id}] Completed ---`);

    } catch (error: any) {
      console.error(`Failed to process job ${job._id}:`, error);
      console.log(`--- Job [${job._id}] Failed ---`);
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

  // Use reactive subscription to watch for pending jobs
  client.onUpdate(api.printJobs.getOldestPendingJob, { clientId: clientId as string, apiKey: process.env.API_KEY }, async (pendingJob) => {
    // When a pending job appears and we're not busy, claim and process it
    if (pendingJob && !isProcessing) {
      isProcessing = true;
      try {
        // Atomically claim the job (marks as processing and returns with file URL)
        const job = await client.mutation(api.printJobs.claimNextJob, { 
          clientId: clientId as string, 
          apiKey: process.env.API_KEY 
        });
        
        if (job) {
          await handleJob(job, client, logOnly);
        }
      } catch (error) {
        console.error("Error claiming/processing job:", error);
      } finally {
        isProcessing = false;
      }
    }
  });

  // Process any pending jobs immediately on startup
  async function processStartupJobs() {
    while (!isProcessing) {
      try {
        isProcessing = true;
        const job = await client.mutation(api.printJobs.claimNextJob, { 
          clientId: clientId as string, 
          apiKey: process.env.API_KEY 
        });
        
        if (!job) {
          isProcessing = false;
          break;
        }
        
        await handleJob(job, client, logOnly);
        isProcessing = false;
      } catch (error) {
        console.error("Error processing startup jobs:", error);
        isProcessing = false;
        break;
      }
    }
  }
  
  processStartupJobs();
}

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);
if (isMainModule) {
  main();
}