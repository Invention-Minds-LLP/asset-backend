/*
  Warnings:

  - A unique constraint covering the columns `[referenceCode]` on the table `asset` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE `AssetSpecification` ADD COLUMN `isMandatory` BOOLEAN NULL DEFAULT false,
    ADD COLUMN `remarks` TEXT NULL,
    ADD COLUMN `sortOrder` INTEGER NULL DEFAULT 0,
    ADD COLUMN `source` VARCHAR(191) NULL,
    ADD COLUMN `specificationGroup` VARCHAR(191) NULL,
    ADD COLUMN `unit` VARCHAR(191) NULL,
    ADD COLUMN `valueType` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `asset` ADD COLUMN `customDetails` TEXT NULL,
    ADD COLUMN `isAssembled` BOOLEAN NULL DEFAULT false,
    ADD COLUMN `isBranded` BOOLEAN NULL DEFAULT false,
    ADD COLUMN `isCustomized` BOOLEAN NULL DEFAULT false,
    ADD COLUMN `organogramNotes` TEXT NULL,
    ADD COLUMN `pmFormatNotes` TEXT NULL,
    ADD COLUMN `referenceCode` VARCHAR(191) NULL,
    ADD COLUMN `specificationSummary` TEXT NULL,
    ADD COLUMN `ticketHierarchyNotes` TEXT NULL;

-- AlterTable
ALTER TABLE `assetlocation` ADD COLUMN `departmentSnapshot` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `vendor` ADD COLUMN `alternatePhone` VARCHAR(191) NULL,
    ADD COLUMN `contactPerson` VARCHAR(191) NULL,
    ADD COLUMN `notes` TEXT NULL;

-- AlterTable
ALTER TABLE `warranty` ADD COLUMN `coverageDetails` TEXT NULL,
    ADD COLUMN `exclusions` TEXT NULL,
    ADD COLUMN `remarks` TEXT NULL,
    ADD COLUMN `supportContact` VARCHAR(191) NULL,
    ADD COLUMN `supportEmail` VARCHAR(191) NULL,
    ADD COLUMN `termsUrl` VARCHAR(191) NULL,
    ADD COLUMN `vendorId` INTEGER NULL,
    ADD COLUMN `warrantyProvider` VARCHAR(191) NULL,
    ADD COLUMN `warrantyReference` VARCHAR(191) NULL,
    ADD COLUMN `warrantyType` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `assetacknowledgementtemplate` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `assetCategoryId` INTEGER NULL,
    `assetId` INTEGER NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `assetacknowledgementtemplate_assetCategoryId_idx`(`assetCategoryId`),
    INDEX `assetacknowledgementtemplate_assetId_idx`(`assetId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `assetacknowledgementitem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `templateId` INTEGER NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isRequired` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `assetacknowledgementitem_templateId_sortOrder_idx`(`templateId`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `assetacknowledgementrun` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `assetId` INTEGER NOT NULL,
    `templateId` INTEGER NULL,
    `assignedToId` INTEGER NULL,
    `acknowledgedAt` DATETIME(3) NULL,
    `acknowledgedBy` VARCHAR(191) NULL,
    `remarks` TEXT NULL,
    `digitalSignature` LONGTEXT NULL,
    `photoProof` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `assetacknowledgementrun_assetId_createdAt_idx`(`assetId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `assetacknowledgementresult` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `runId` INTEGER NOT NULL,
    `itemId` INTEGER NOT NULL,
    `checked` BOOLEAN NOT NULL DEFAULT false,
    `remarks` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `assetacknowledgementresult_runId_itemId_key`(`runId`, `itemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pmchecklisttemplate` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `pmFormatCode` VARCHAR(191) NULL,
    `assetCategoryId` INTEGER NULL,
    `assetId` INTEGER NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `pmchecklisttemplate_assetCategoryId_idx`(`assetCategoryId`),
    INDEX `pmchecklisttemplate_assetId_idx`(`assetId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pmchecklistitem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `templateId` INTEGER NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `itemType` VARCHAR(191) NULL,
    `expectedValue` VARCHAR(191) NULL,
    `unit` VARCHAR(191) NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isRequired` BOOLEAN NOT NULL DEFAULT true,

    INDEX `pmchecklistitem_templateId_sortOrder_idx`(`templateId`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pmchecklistrun` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `assetId` INTEGER NOT NULL,
    `templateId` INTEGER NOT NULL,
    `maintenanceHistoryId` INTEGER NULL,
    `scheduledDue` DATETIME(3) NOT NULL,
    `performedAt` DATETIME(3) NULL,
    `performedBy` VARCHAR(191) NULL,
    `resultStatus` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `pmchecklistrun_assetId_scheduledDue_idx`(`assetId`, `scheduledDue`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pmchecklistresult` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `runId` INTEGER NOT NULL,
    `itemId` INTEGER NOT NULL,
    `checked` BOOLEAN NULL,
    `value` VARCHAR(191) NULL,
    `remarks` TEXT NULL,
    `photoProof` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `pmchecklistresult_runId_itemId_key`(`runId`, `itemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `calibrationchecklisttemplate` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `assetCategoryId` INTEGER NULL,
    `assetId` INTEGER NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `calibrationchecklisttemplate_assetCategoryId_idx`(`assetCategoryId`),
    INDEX `calibrationchecklisttemplate_assetId_idx`(`assetId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `calibrationchecklistitem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `templateId` INTEGER NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `expectedValue` VARCHAR(191) NULL,
    `unit` VARCHAR(191) NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isRequired` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `calibrationchecklistitem_templateId_sortOrder_idx`(`templateId`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `assetsupportmatrix` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `assetCategoryId` INTEGER NULL,
    `assetId` INTEGER NULL,
    `levelNo` INTEGER NOT NULL,
    `roleName` VARCHAR(191) NULL,
    `personName` VARCHAR(191) NULL,
    `employeeId` INTEGER NULL,
    `contactNumber` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `escalationTime` INTEGER NULL,
    `escalationUnit` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `assetsupportmatrix_assetCategoryId_assetId_levelNo_idx`(`assetCategoryId`, `assetId`, `levelNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `asset_referenceCode_key` ON `asset`(`referenceCode`);

-- AddForeignKey
ALTER TABLE `warranty` ADD CONSTRAINT `warranty_vendorId_fkey` FOREIGN KEY (`vendorId`) REFERENCES `vendor`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assetacknowledgementtemplate` ADD CONSTRAINT `assetacknowledgementtemplate_assetCategoryId_fkey` FOREIGN KEY (`assetCategoryId`) REFERENCES `assetcategory`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assetacknowledgementtemplate` ADD CONSTRAINT `assetacknowledgementtemplate_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `asset`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assetacknowledgementitem` ADD CONSTRAINT `assetacknowledgementitem_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `assetacknowledgementtemplate`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assetacknowledgementrun` ADD CONSTRAINT `assetacknowledgementrun_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `asset`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assetacknowledgementrun` ADD CONSTRAINT `assetacknowledgementrun_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `assetacknowledgementtemplate`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assetacknowledgementrun` ADD CONSTRAINT `assetacknowledgementrun_assignedToId_fkey` FOREIGN KEY (`assignedToId`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assetacknowledgementresult` ADD CONSTRAINT `assetacknowledgementresult_runId_fkey` FOREIGN KEY (`runId`) REFERENCES `assetacknowledgementrun`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assetacknowledgementresult` ADD CONSTRAINT `assetacknowledgementresult_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `assetacknowledgementitem`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pmchecklisttemplate` ADD CONSTRAINT `pmchecklisttemplate_assetCategoryId_fkey` FOREIGN KEY (`assetCategoryId`) REFERENCES `assetcategory`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pmchecklisttemplate` ADD CONSTRAINT `pmchecklisttemplate_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `asset`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pmchecklistitem` ADD CONSTRAINT `pmchecklistitem_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `pmchecklisttemplate`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pmchecklistrun` ADD CONSTRAINT `pmchecklistrun_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `asset`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pmchecklistrun` ADD CONSTRAINT `pmchecklistrun_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `pmchecklisttemplate`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pmchecklistrun` ADD CONSTRAINT `pmchecklistrun_maintenanceHistoryId_fkey` FOREIGN KEY (`maintenanceHistoryId`) REFERENCES `maintenancehistory`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pmchecklistresult` ADD CONSTRAINT `pmchecklistresult_runId_fkey` FOREIGN KEY (`runId`) REFERENCES `pmchecklistrun`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pmchecklistresult` ADD CONSTRAINT `pmchecklistresult_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `pmchecklistitem`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `calibrationchecklisttemplate` ADD CONSTRAINT `calibrationchecklisttemplate_assetCategoryId_fkey` FOREIGN KEY (`assetCategoryId`) REFERENCES `assetcategory`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `calibrationchecklisttemplate` ADD CONSTRAINT `calibrationchecklisttemplate_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `asset`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `calibrationchecklistitem` ADD CONSTRAINT `calibrationchecklistitem_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `calibrationchecklisttemplate`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assetsupportmatrix` ADD CONSTRAINT `assetsupportmatrix_assetCategoryId_fkey` FOREIGN KEY (`assetCategoryId`) REFERENCES `assetcategory`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assetsupportmatrix` ADD CONSTRAINT `assetsupportmatrix_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `asset`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assetsupportmatrix` ADD CONSTRAINT `assetsupportmatrix_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
