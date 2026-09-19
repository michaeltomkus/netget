import { PrismaClient } from "@prisma/client";

// Singleton — avoids exhausting Postgres connections from multiple client
// instances across hot-reloads in dev (tsx watch) and across the many
// modules that need DB access.
export const prisma = new PrismaClient();
