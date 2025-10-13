import { cronJobs } from "convex/server";
import { api } from "./_generated/api.js";

const crons = cronJobs();

crons.cron(
  "cleanup old data",
  "0 2 * * *", // Daily at 2:00 AM UTC
  api.printJobs.cleanupOldData,
);

export default crons;
