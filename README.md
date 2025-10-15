
# Convex Print Server

This is a serverless solution for printing documents from web applications using [Convex](https://convex.dev) for the backend. Perfect for logistics needs, such as printing order documents or shipping labels in a warehouse from a web UI.

A REST endpoint is provided to submit print jobs from any external system. Jobs are received by a command-line client that listens for jobs and sends them to a CUPS printer on the local network.

The serverless architecture makes it scalable and hosting costs (your Convex bill) is free for any reasonable amount of usage. This makes it the perfect replacement for paid services such as [PrintNode](https://printnode.com).

## Prerequisites

- Node.js (v16+)
- CUPS printing system (comes pre-installed on macOS, available on Linux and Windows with WSL)

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

## Usage

### Starting the Client

To start a print client, you need to give it a unique `clientId`. The client will listen for any jobs assigned to this ID.

```bash
npm run client my-office-client
```

To start the client in **log-only mode** (where it will log job details instead of sending them to the printer), use the `client-log` command:

```bash
npm run client-log my-office-client
```

### Submitting a Print Job

Use the `print` command to send a file to a specific client and printer.

**Syntax:**

```
node print <file_path> <client_id> <printer_name> [cups_options] [context]
```

- `context`: An optional string that can be used to save context when printing (e.g., user ID, order ID). This context can be used to search for print jobs in the Convex dashboard.

**Examples:**

Basic print job:

```bash
node print test-files/product-label.pdf my-office-client "Brother MFC-L3770CDW series"
```

With CUPS options and context:

```bash
node print test-files/product-label.pdf my-office-client 192.168.7.101 "-o media=Custom.62x50mm -o cutMedia=endOfPage" "order: 123; user: 321"
```

## Features

### Automatic Printer Registration

The print client will automatically register a printer with the local CUPS server if a print job is received for a printer that is not yet registered.

### Protocol Support

The client supports `ipp`, `socket`, and `lpd` protocols for printing. The protocol can be specified as part of the `printerId` when submitting a print job. If no protocol is specified, `ipp` is used as the default.

**Examples:**

- `ipp://192.168.1.100`
- `socket://Brother_Printer`
- `lpd://my-printer.local`

### Custom Printer Drivers

You can configure the client to use specific printer drivers (PPD files) for different printers. This is useful for printers that are not supported by the default `-m everywhere` option.

To configure custom drivers, add entries to your `.env` file in the following format:

```
PRINTER_DRIVER_<number>="<pattern>:<driver_path>"
```

- `<number>`: A unique number to distinguish between different driver mappings (e.g., `1`, `2`, `3`).
- `<pattern>`: A wildcard pattern to match against the printer's `protocol://host`. `*` can be used as a wildcard.
- `<driver_path>`: The absolute path to the PPD file on the client machine.

**Example:**

To use the `BrotherQL820NwbCupsPpd.gz` driver for all `socket` printers, add the following line to your `.env` file:

```
PRINTER_DRIVER_1="socket://*:drivers/BrotherQL820NwbCupsPpd.gz"
```

To use a specific driver for a single printer:

```
PRINTER_DRIVER_2="ipp://192.168.1.100:drivers/MySpecificDriver.ppd"
```

If no custom driver is found for a printer, the client will use the `-m everywhere` option for `ipp` printers, and no driver option for other protocols.

### Printer Name Normalization

The print client automatically normalizes printer names to a format that is compatible with CUPS. This normalization is done on the client-side.

When submitting a print job, the `printerId` should be the raw, un-normalized printer name, including the protocol if needed.

**Examples:**

- `ipp://192.168.7.101`
- `socket://10.0.0.5`
- `Brother MFC-L3770CDW series`

The client will then generate a CUPS-compatible printer name from the host part of the `printerId`. For example, `ipp://192.168.7.101` will be normalized to `_192_168_7_101`.

## Deployment

To deploy the Convex backend, run the following command:

```bash
npx convex deploy
```

This will deploy your backend functions, database, and file storage to the Convex cloud.

You will also need to set your environment variables in the Convex dashboard. Go to your project settings and add the `API_KEY`.

To run the client on a production machine, you will need to set the `CONVEX_URL` and `API_KEY` environment variables. You can get the `CONVEX_URL` from the Convex dashboard.

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
