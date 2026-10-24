// Removes previous build output.
import { rmSync } from "node:fs";

for (const dir of ["dist", "client/dist", "server/dist"]) {
  rmSync(dir, { recursive: true, force: true });
}
