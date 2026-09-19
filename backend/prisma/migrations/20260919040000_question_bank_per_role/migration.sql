-- Corrects the previous migration's design: a role's questions are now a
-- growing, reusable BANK (BankQuestion) rather than one fixed cached
-- QuestionSet replayed identically to every candidate. QuestionSet reverts
-- to being owned by one Session again; each session assembles its own draw
-- from the bank.

-- AlterTable: QuestionSet drops jobRoleId, regains sessionId.
ALTER TABLE "QuestionSet" DROP COLUMN "jobRoleId";
ALTER TABLE "QuestionSet" ADD COLUMN "sessionId" TEXT;

-- Every existing QuestionSet row (if any) was created under the previous,
-- now-corrected design and has no real session to point at — this app
-- isn't deployed anywhere with real data yet, so there is nothing to
-- backfill; the NOT NULL is added directly.
ALTER TABLE "QuestionSet" ALTER COLUMN "sessionId" SET NOT NULL;

CREATE UNIQUE INDEX "QuestionSet_sessionId_key" ON "QuestionSet"("sessionId");
ALTER TABLE "QuestionSet" ADD CONSTRAINT "QuestionSet_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: JobRole drops its single cached questionSetId, gains a
-- denormalized bankSize counter instead.
ALTER TABLE "JobRole" DROP COLUMN "questionSetId";
ALTER TABLE "JobRole" ADD COLUMN "bankSize" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "BankQuestion" (
    "id" TEXT NOT NULL,
    "jobRoleId" TEXT NOT NULL,
    "type" "QuestionType" NOT NULL,
    "discipline" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "idealAnswerCriteria" TEXT NOT NULL,
    "expectedStructure" "ExpectedStructure",
    "followUpTriggers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ttsAudioBlobRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "timesUsed" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "BankQuestion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BankQuestion_jobRoleId_type_idx" ON "BankQuestion"("jobRoleId", "type");
ALTER TABLE "BankQuestion" ADD CONSTRAINT "BankQuestion_jobRoleId_fkey" FOREIGN KEY ("jobRoleId") REFERENCES "JobRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
