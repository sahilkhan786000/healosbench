import { env } from "@test-evals/env/server";
import { drizzle } from "drizzle-orm/node-postgres";

export * from "./schema";

import * as schema from "./schema";

export function createDb() {
  return drizzle(env.DATABASE_URL, { schema });
}

export const db = createDb();
