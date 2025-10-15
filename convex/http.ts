
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import { validateApiKey } from "./printJobs.js";

const http = httpRouter();

http.route({
  path: "/print",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const providedApiKey = request.headers.get("x-api-key") ?? undefined;
    
    try {
      validateApiKey(providedApiKey);
    } catch (error) {
      return new Response("Unauthorized", { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("file");
    const clientId = formData.get("clientId") as string;
    const printerIdRaw = formData.get("printerId") as string;
    const cupsOptions = formData.get("cupsOptions") as string;
    const context = formData.get("context") as string;

    if (!(file instanceof File)) {
      return new Response("No file uploaded", { status: 400 });
    }

    const printerId = printerIdRaw;

    const fileStorageId = await ctx.storage.store(file);

    const mutationArgs: any = {
      clientId,
      printerId,
      fileStorageId,
      cupsOptions,
    };

    if (context) {
      mutationArgs.context = context;
    }

    await ctx.runMutation(internal.printJobs.createPrintJob, mutationArgs);

    return new Response("Print job created");
  }),
});

export default http;
