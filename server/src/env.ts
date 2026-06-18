// Load environment variables before anything else imports the Gemini client.
// The server process runs from the `server/` directory, but the project's .env
// lives at the repo root — so we explicitly look in both places (plus cwd).
// dotenv does not override already-set vars, so the first match wins.
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url)); // .../server/src

dotenv.config({ path: resolve(here, "../../.env") }); // repo root
dotenv.config({ path: resolve(here, "../.env") }); // server/.env
dotenv.config(); // current working directory
