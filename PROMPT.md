# Convex print server

This is a completely new project. I want you to implement an online print server using Convex. Write tests, code and documentation. Before you begin, make a more detailed plan for the project and ask me questions if you need to.

Here are the requirements:

- Use TypeScipt wherever possible.
- Use locally running Convex for the backend.
- Use Vitest for testing.

# How it should work

There is no user interface, just a REST endpoint where someone (most likely an external application) can send a print job via an HTTP call. A print job consists of:

- A client ID
- A printer ID
- A printable file, most likely a small PDF file
- Print settings as a CUPS string, like paper size, number of copies, etc.

This project also provides a simple command line that can start a local client that is listening for print jobs with it's own ID. As soon as the client receives a print job, it should print the file to the specified printer using CUPS.

For example, to start a local client with the ID "my-client", you can run:

```
node client my-client
```

There is also a mode where incoming print jobs are not printed, but logged to the console. To start the client in this mode, you can run:

```
node client my-client --log
```

For development purposes, also provide a command to send a print job to the client. To do this, you can run:

```
node print test-files/product-label.pdf my-client Brother_Printer "-o media=Custom.62x50mm -o cutMedia=endOfPage"
```

This will send a print job to the printer "Brother_Printer" that is known to the client with the ID "my-client".
