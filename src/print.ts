import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import FormData from "form-data";
import "dotenv/config";

async function main() {
  const { file, clientId, printerId, cupsOptions } = await yargs(hideBin(process.argv))
    .command('$0 <file> <clientId> <printerId> [cupsOptions]', 'Sends a print job to a client.', (yargs) => {
      return yargs
        .positional('file', {
          describe: 'Path to the file to print',
          type: 'string',
        })
        .positional('clientId', {
          describe: 'The ID of the print client',
          type: 'string',
        })
        .positional('printerId', {
          describe: 'The name of the printer to use',
          type: 'string',
        })
        .positional('cupsOptions', {
          describe: 'Optional string of CUPS options',
          type: 'string',
          default: '',
        });
    })
    .demandCommand(3, 'You must provide at least a file, client ID, and printer ID.')
    .help()
    .argv;

  if (typeof file !== 'string' || typeof clientId !== 'string' || typeof printerId !== 'string') {
    console.error('Invalid arguments. Please provide a file, client ID, and printer ID.');
    process.exit(1);
  }

  const convexUrl = process.env.CONVEX_URL;
  if (!convexUrl) {
    console.error("Error: CONVEX_URL environment variable not set.");
    console.error("Run `npx convex dev` in a separate terminal.");
    process.exit(1);
  }

  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    console.error("Error: API_KEY environment variable not set.");
    process.exit(1);
  }

  // Use the proxy URL for HTTP routes (port 3211 instead of 3210)
  const httpUrl = convexUrl.replace(':3210', ':3211');
  const printUrl = new URL("/print", httpUrl).href;

  const filePath = path.resolve(file);

  if (!fs.existsSync(filePath)) {
    console.error(`Error: File not found at ${filePath}`);
    process.exit(1);
  }

  const form = new FormData();
  form.append("clientId", clientId);
  form.append("printerId", printerId);
  form.append("cupsOptions", cupsOptions);
  form.append("file", fs.createReadStream(filePath));

  try {
    const response = await fetch(printUrl, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        ...form.getHeaders(),
      },
      body: form,
    });

    const responseText = await response.text();

    if (!response.ok) {
      console.error(`Error: ${response.status} ${response.statusText}`);
      console.error(responseText);
      process.exit(1);
    }

    console.log("Server response:", responseText);
  } catch (error) {
    console.error("Failed to send print job:", error);
    process.exit(1);
  }
}

main().catch(console.error);