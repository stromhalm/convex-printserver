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

export async function handleJob(job: any, logOnly: boolean) {
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

      // Stream file directly to printer via stdin (no temp file needed)
      let printCommand = `lp -d "${printerName}"`;
      if (job.cupsOptions) {
        printCommand += ` ${job.cupsOptions}`;
      }
      console.log(`  Executing: ${printCommand}`);

      let retries = 1;

      const attemptPrint = async () => {
        try {
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
              // Handle pipe errors to prevent unhandled EPIPE errors
              response.body.on('error', (err) => {
                console.error(`Stream error while piping to print command: ${err.message}`);
                reject(err);
              });
              
              child.stdin.on('error', (err) => {
                // Ignore EPIPE errors on stdin - they occur when lp closes early
                if (err.message.includes('EPIPE')) {
                  console.warn(`Print command closed stdin early (this may be normal): ${err.message}`);
                } else {
                  console.error(`Stdin error: ${err.message}`);
                  reject(err);
                }
              });
              
              response.body.pipe(child.stdin);
            }
            else {
              reject(new Error("Failed to pipe file to print command"));
            }
          });
        } catch (error: any) {
          if (retries > 0 && error.message.includes("lp: No such file or directory")) {
            retries--;
            console.log("Printer not found, attempting to register...");
            let registerCommand = `lpadmin -p ${printerName} -E -v "${protocol}://${host}"`;

            const driverPath = findDriver(protocol, host);
            if (driverPath) {
              registerCommand += ` -P "${driverPath}"`;
            } else if (protocol === 'ipp') {
              registerCommand += ` -m everywhere`;
            }

            console.log(`  Executing: ${registerCommand}`);
            await new Promise<void>((resolve, reject) => {
              exec(registerCommand, (error, stdout, stderr) => {
                if (error) {
                  console.error(`Failed to register printer: ${error.message}`);
                  if (stderr) console.error(`Stderr: ${stderr}`);
                  reject(error);
                  return;
                }
                if (stdout) console.log(`Stdout: ${stdout}`);
                console.log("Printer registered, retrying print job...");
                resolve();
              });
            });
            await attemptPrint();
          } else {
            throw error;
          }
        }
      }

      await attemptPrint();

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

  // Unified job processing function
  async function processJob(jobId: any) {
    if (isProcessing) return;
    
    isProcessing = true;
    try {
      // Atomically claim the job (marks as completed and returns with file URL)
      const job = await client.mutation(api.printJobs.claimJob, { 
        jobId, 
        apiKey: process.env.API_KEY 
      });
      
      if (job) {
        await handleJob(job, logOnly);
      }
    } catch (error) {
      console.error("Error claiming/processing job:", error);
    } finally {
      isProcessing = false;
      
      // Check if there are more pending jobs and process them
      const nextJob = await client.query(api.printJobs.getOldestPendingJob, { 
        clientId: clientId as string, 
        apiKey: process.env.API_KEY 
      });
      if (nextJob) {
        await processJob(nextJob._id);
      }
    }
  }

  // Use reactive subscription to watch for pending jobs (handles both startup and incoming)
  client.onUpdate(api.printJobs.getOldestPendingJob, { clientId: clientId as string, apiKey: process.env.API_KEY }, async (pendingJob) => {
    if (pendingJob && !isProcessing) {
      await processJob(pendingJob._id);
    }
  });
}

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);
if (isMainModule) {
  main();
}