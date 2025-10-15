#!/usr/bin/env -S npx tsx
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import FormData from "form-data";
import "dotenv/config";

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 3) {
    console.log("Usage: node print <file> <clientId> <printerId> [cupsOptions] [context]\n\nSends a print job to a client.\n");
    process.exit(1);
  }
  const file = args[0];
  const clientId = args[1];
  const printerId = args[2];
  const cupsOptionsStr = args[3] || "";
  const context = args[4];

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
    console.warn("Warning: API_KEY not set; sending request without authentication header.");
  }

  const printUrl = new URL("/http/print", convexUrl).href;
  const filePath = path.resolve(file);

  if (!fs.existsSync(filePath)) {
    console.error(`Error: File not found at ${filePath}`);
    process.exit(1);
  }

  try {
    const form = new FormData();
    form.append("clientId", clientId);
    form.append("printerId", printerId);
    form.append("cupsOptions", cupsOptionsStr);
    if (context) {
      form.append("context", context);
    }
    form.append("file", fs.createReadStream(filePath));

    const response = await fetch(printUrl, {
      method: "POST",
      headers: {
        ...(apiKey ? { "x-api-key": apiKey } : {})
      },
      body: form,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "<no body>");
      console.error(`Error: ${response.status} ${response.statusText}`);
      console.error(errorText);
      process.exit(1);
    }

    console.log("Print job submitted successfully");
  } catch (error) {
    console.error("Failed to send print job:", error);
    process.exit(1);
  }
}

main().catch(console.error);

