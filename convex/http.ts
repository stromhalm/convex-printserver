
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server.js";
import { api } from "./_generated/api.js";

// Normalize printer name to CUPS internal format
// - Replace spaces with underscores
// - Replace dots with underscores
// - Prepend underscore if name starts with a digit
function normalizePrinterName(name: string): string {
  let normalized = name.replace(/[\s.]/g, '_');
  if (/^\d/.test(normalized)) {
    normalized = '_' + normalized;
  }
  return normalized;
}

const http = httpRouter();

http.route({
  path: "/print",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const apiKey = process.env.API_KEY;
    if (apiKey) {
      const providedApiKey = request.headers.get("x-api-key");
      if (providedApiKey !== apiKey) {
        return new Response("Unauthorized", { status: 401 });
      }
    } else {
      if (process.env.NODE_ENV !== "test") {
        console.warn("Warning: API_KEY not set; allowing unauthenticated HTTP /print requests.");
      }
    }

    const formData = await request.formData();
    const file = formData.get("file");
    const clientId = formData.get("clientId") as string;
    const printerIdRaw = formData.get("printerId") as string;
    const cupsOptions = formData.get("cupsOptions") as string;

    if (!(file instanceof File)) {
      return new Response("No file uploaded", { status: 400 });
    }

    // Normalize printer name to CUPS format
    const printerId = normalizePrinterName(printerIdRaw);

    const fileStorageId = await ctx.storage.store(file);

    await ctx.runMutation(api.printJobs.createPrintJob, {
      clientId,
      printerId,
      fileStorageId,
      cupsOptions,
    });

    return new Response("Print job created");
  }),
});

export default http;
