import { createConnection } from "net";

/**
 * Checks if a port is open by attempting to establish a socket connection
 * @param host - The host to connect to (defaults to localhost)
 * @param port - The port number to check
 * @param timeout - Connection timeout in milliseconds (defaults to 5000ms)
 * @returns Promise<boolean> - true if port is open, false if closed or unreachable
 */
export async function isPortOpen({
  host = "localhost",
  port,
  timeout = 5000,
}: {
  host: string;
  port: number;
  timeout: number;
}): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({
      host,
      port,
      timeout,
    });

    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });

    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });

    socket.on("error", () => {
      socket.destroy();
      resolve(false);
    });
  });
}
