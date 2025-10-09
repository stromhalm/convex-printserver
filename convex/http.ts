
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server.js";
import { api } from "./_generated/api.js";

const http = httpRouter();

http.route({
  path: "/print",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const apiKey = process.env.API_KEY;
    if (!apiKey) {
      return new Response("API_KEY is not set", { status: 500 });
    }

    const providedApiKey = request.headers.get("x-api-key");
    if (providedApiKey !== apiKey) {
      return new Response("Unauthorized", { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("file");
    const clientId = formData.get("clientId") as string;
    const printerId = formData.get("printerId") as string;
    const cupsOptions = formData.get("cupsOptions") as string;

    if (!(file instanceof File)) {
      return new Response("No file uploaded", { status: 400 });
    }

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
