-- CreateEnum
CREATE TYPE "CommunicationChannel" AS ENUM ('email', 'sms', 'push');
CREATE TYPE "CommunicationSendStatus" AS ENUM ('sent', 'skipped_no_provider', 'failed');

-- CreateTable
CREATE TABLE "CommunicationTemplate" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "typeName" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "channel" "CommunicationChannel" NOT NULL,
    "variant" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "variablesUsed" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunicationTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CommunicationTemplate_key_key" ON "CommunicationTemplate"("key");
CREATE UNIQUE INDEX "CommunicationTemplate_typeName_channel_variant_key" ON "CommunicationTemplate"("typeName", "channel", "variant");
CREATE INDEX "CommunicationTemplate_category_idx" ON "CommunicationTemplate"("category");

-- CreateTable
CREATE TABLE "CommunicationSend" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channel" "CommunicationChannel" NOT NULL,
    "variant" TEXT NOT NULL,
    "status" "CommunicationSendStatus" NOT NULL,
    "renderedSubject" TEXT,
    "renderedBody" TEXT NOT NULL,
    "error" TEXT,
    "sentByUserId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunicationSend_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CommunicationSend_userId_idx" ON "CommunicationSend"("userId");
CREATE INDEX "CommunicationSend_templateId_variant_idx" ON "CommunicationSend"("templateId", "variant");
CREATE INDEX "CommunicationSend_batchId_idx" ON "CommunicationSend"("batchId");

-- AddForeignKey
ALTER TABLE "CommunicationSend" ADD CONSTRAINT "CommunicationSend_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "CommunicationTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommunicationSend" ADD CONSTRAINT "CommunicationSend_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
