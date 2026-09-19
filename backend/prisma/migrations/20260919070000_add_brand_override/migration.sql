-- CreateTable
CREATE TABLE "BrandOverride" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "variantKey" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByUserId" TEXT,

    CONSTRAINT "BrandOverride_pkey" PRIMARY KEY ("id")
);
