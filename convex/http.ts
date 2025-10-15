import { httpRouter } from "convex/server";
import { printAction } from "./printJobs.js";

const http = httpRouter();

// HTTP routes
http.route({
    path: "/print",
    method: "POST",
    handler: printAction
});

export default http;

