
# Convex Print Server

This project implements a simple, real-time print server using [Convex](https://convex.dev) for the backend. It provides a REST endpoint to submit print jobs and a command-line client that listens for jobs and sends them to a CUPS printer.

## Features

- Real-time job delivery using Convex subscriptions (no polling).
- Simple, secure REST endpoint with API key authentication.
- Command-line client to connect any machine to the print server.
- A separate command-line tool for submitting print jobs.
- Log-only mode for debugging.

## Prerequisites

- Node.js (v16+)
- A configured CUPS print server on the machine running the client.

## Setup

1.  **Install Dependencies:**

    ```bash
    npm install
    ```

2.  **Configure Environment Variables:**

    Create a `.env` file by copying the example file:

    ```bash
    cp .env.example .env
    ```

    Fill in the `API_KEY` with a new secret key. The `CONVEX_URL` will be populated automatically when you start the Convex development server.

3.  **Start the Convex Backend:**

    Run the Convex development server in a separate terminal. This will handle your backend functions, database, and file storage.

    ```bash
    npx convex dev
    ```

4.  **Build the Client Code:**

    Compile the TypeScript client and print tools:

    ```bash
    npm run build
    ```

## Usage

### Starting the Client

To start a print client, you need to give it a unique `clientId`. The client will listen for any jobs assigned to this ID.

```bash
node dist/client.js my-office-client
```

To start the client in **log-only mode** (where it will log job details instead of sending them to the printer), use the `--log` flag:

```bash
node dist/client.js my-office-client --log
```

### Submitting a Print Job

Use the `print` command to send a file to a specific client and printer.

**Syntax:**

```
node dist/print.js <file_path> <client_id> <printer_name> -- <cups_options>
```

**Example:**

This sends a test PDF to the `Brother_Printer` printer, which is handled by the `my-office-client` client. It also specifies a custom paper size.

```bash
node dist/print.js test-files/product-label.pdf my-office-client Brother_Printer -- -o media=Custom.62x50mm -o cutMedia=endOfPage
```

## Data Cleanup

The system automatically cleans up old print jobs and files on a daily schedule. By default, data older than 30 days is deleted. This includes:

- Completed, failed, and processing print jobs
- Associated files in storage that are no longer referenced

To configure the cleanup age:

```bash
npx convex env set CLEANUP_MAX_AGE_DAYS 7  # Clean up data older than 7 days
```

The cleanup runs daily at 2:00 AM UTC via an automated cron job defined in `convex/crons.ts`.

## Testing

To run the backend unit tests, execute:

```bash
npm test
```
