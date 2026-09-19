-- CreateEnum
CREATE TYPE "JobRoleStatus" AS ENUM ('approved', 'rejected');

-- CreateTable
CREATE TABLE "JobRole" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "normalizedKey" TEXT NOT NULL,
    "seniority" "Seniority" NOT NULL,
    "status" "JobRoleStatus" NOT NULL,
    "saturationScore" INTEGER NOT NULL,
    "saturationRationale" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "questionSetId" TEXT,
    "usageCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "JobRole_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "JobRole_normalizedKey_seniority_key" ON "JobRole"("normalizedKey", "seniority");

-- CreateIndex
CREATE INDEX "JobRole_seniority_status_idx" ON "JobRole"("seniority", "status");

-- AlterTable: Session gains jobRoleId + scheduledFor (both nullable — every
-- existing row is treated as an already-instant-started, non-catalog
-- session, which is accurate: the catalog didn't exist before this).
ALTER TABLE "Session" ADD COLUMN "jobRoleId" TEXT;
ALTER TABLE "Session" ADD COLUMN "scheduledFor" TIMESTAMP(3);

-- AlterTable: QuestionSet flips from "owned 1:1 by a Session" to "owned 1:1
-- by a JobRole, referenced by many Sessions via their own questionSetId".
-- Drops the old sessionId FK/unique/column entirely — nothing reads
-- QuestionSet.sessionId (call sites all go through Session.questionSetId,
-- the denormalized scalar, which is untouched by this migration) — and
-- pre-existing QuestionSet rows simply end up with jobRoleId = NULL
-- ("legacy, one-off, not part of the catalog"), which is exactly what they are.
ALTER TABLE "QuestionSet" DROP CONSTRAINT "QuestionSet_sessionId_fkey";
DROP INDEX "QuestionSet_sessionId_key";
ALTER TABLE "QuestionSet" DROP COLUMN "sessionId";
ALTER TABLE "QuestionSet" ADD COLUMN "jobRoleId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "QuestionSet_jobRoleId_key" ON "QuestionSet"("jobRoleId");
