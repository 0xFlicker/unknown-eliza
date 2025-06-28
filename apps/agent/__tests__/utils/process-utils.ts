import { execSync } from "node:child_process";

/**
 * Kill process on a specific port with cross-platform support
 */
export async function killProcessOnPort(port: number): Promise<void> {
  try {
    if (process.platform === "win32") {
      // Windows: More reliable process killing
      const netstatResult = execSync(`netstat -ano | findstr :${port}`, {
        encoding: "utf8",
        stdio: "pipe",
      });

      const lines = netstatResult
        .split("\n")
        .filter((line) => line.includes(`:${port}`));
      const pids = lines
        .map((line) => {
          const parts = line.trim().split(/\s+/);
          return parts[parts.length - 1];
        })
        .filter((pid) => pid && pid !== "0");

      for (const pid of pids) {
        try {
          execSync(`taskkill /F /PID ${pid}`, { stdio: "ignore" });
        } catch (e) {
          // Ignore if process is already dead
        }
      }
    } else if (process.platform === "darwin") {
      // macOS: More reliable process killing with better error handling
      try {
        // First try to find processes listening on the port with increased timeout
        const lsofResult = execSync(`lsof -ti:${port}`, {
          encoding: "utf8",
          stdio: "pipe",
          timeout: 10000, // Increased timeout for CI
        });

        const pids = lsofResult
          .trim()
          .split("\n")
          .filter((pid) => pid && /^\d+$/.test(pid));
        console.log(
          `[DEBUG] Found ${pids.length} processes on port ${port}: ${pids.join(", ")}`,
        );

        for (const pid of pids) {
          try {
            // Check if process exists first
            execSync(`ps -p ${pid}`, { stdio: "ignore", timeout: 2000 });

            // Try SIGTERM first
            console.log(`[DEBUG] Sending SIGTERM to PID ${pid}`);
            execSync(`kill -TERM ${pid}`, { stdio: "ignore", timeout: 3000 });

            // Wait longer for graceful shutdown on macOS CI
            const waitTime = process.env.CI === "true" ? 3000 : 1000;
            await new Promise((resolve) => setTimeout(resolve, waitTime));

            // Check if still running, then force kill
            try {
              execSync(`kill -0 ${pid}`, { stdio: "ignore", timeout: 2000 });
              console.log(
                `[DEBUG] Process ${pid} still running, sending SIGKILL`,
              );
              execSync(`kill -9 ${pid}`, { stdio: "ignore", timeout: 3000 });
              await new Promise((resolve) => setTimeout(resolve, 500));
            } catch (e) {
              // Process already dead, good
              console.log(`[DEBUG] Process ${pid} terminated gracefully`);
            }
          } catch (e) {
            // Process doesn't exist or already killed, ignore
            console.log(
              `[DEBUG] Process ${pid} not found or already terminated`,
            );
          }
        }
      } catch (e) {
        // No processes found on port, which is fine
        console.log(
          `[DEBUG] No processes found on port ${port} (expected if port is free)`,
        );
      }
    } else {
      // Other Unix systems
      execSync(`lsof -ti:${port} | xargs kill -9 2>/dev/null || true`, {
        stdio: "ignore",
        timeout: 5000,
      });
    }

    // Give processes time to actually terminate
    await new Promise((resolve) =>
      setTimeout(resolve, process.platform === "darwin" ? 2000 : 1000),
    );
  } catch (e) {
    // Ignore port cleanup errors but log them for debugging
    console.log(
      `[DEBUG] Port cleanup for ${port} encountered error:`,
      e instanceof Error ? e.message : "unknown",
    );
  }
}
