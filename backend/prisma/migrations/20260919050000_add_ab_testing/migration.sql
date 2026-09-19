-- CreateTable
CREATE TABLE "ExperimentExposure" (
    "id" TEXT NOT NULL,
    "experimentKey" TEXT NOT NULL,
    "variant" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExperimentExposure_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExperimentExposure_experimentKey_subjectId_key" ON "ExperimentExposure"("experimentKey", "subjectId");
CREATE INDEX "ExperimentExposure_experimentKey_variant_idx" ON "ExperimentExposure"("experimentKey", "variant");

-- CreateTable
CREATE TABLE "ExperimentConversion" (
    "id" TEXT NOT NULL,
    "experimentKey" TEXT NOT NULL,
    "variant" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExperimentConversion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExperimentConversion_experimentKey_goal_subjectId_key" ON "ExperimentConversion"("experimentKey", "goal", "subjectId");
CREATE INDEX "ExperimentConversion_experimentKey_variant_goal_idx" ON "ExperimentConversion"("experimentKey", "variant", "goal");
