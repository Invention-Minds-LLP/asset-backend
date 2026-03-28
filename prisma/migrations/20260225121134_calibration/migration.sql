-- AlterTable
ALTER TABLE `asset` ADD COLUMN `installedAt` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `calibrationschedule` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `assetId` INTEGER NOT NULL,
    `frequencyValue` INTEGER NOT NULL,
    `frequencyUnit` VARCHAR(191) NOT NULL,
    `nextDueAt` DATETIME(3) NOT NULL,
    `lastCalibratedAt` DATETIME(3) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `standardProcedure` VARCHAR(191) NULL,
    `vendorId` INTEGER NULL,
    `reminderDays` INTEGER NULL DEFAULT 7,
    `notes` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `calibrationschedule_assetId_nextDueAt_idx`(`assetId`, `nextDueAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `calibrationhistory` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `assetId` INTEGER NOT NULL,
    `scheduleId` INTEGER NULL,
    `calibratedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `dueAt` DATETIME(3) NULL,
    `calibratedByType` VARCHAR(191) NULL,
    `calibratedByName` VARCHAR(191) NULL,
    `vendorId` INTEGER NULL,
    `result` ENUM('PASS', 'FAIL', 'NA') NOT NULL DEFAULT 'NA',
    `certificateNo` VARCHAR(191) NULL,
    `certificateUrl` VARCHAR(191) NULL,
    `remarks` TEXT NULL,
    `createdById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `calibrationhistory_assetId_calibratedAt_idx`(`assetId`, `calibratedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `calibrationschedule` ADD CONSTRAINT `calibrationschedule_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `asset`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `calibrationschedule` ADD CONSTRAINT `calibrationschedule_vendorId_fkey` FOREIGN KEY (`vendorId`) REFERENCES `vendor`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `calibrationhistory` ADD CONSTRAINT `calibrationhistory_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `asset`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `calibrationhistory` ADD CONSTRAINT `calibrationhistory_scheduleId_fkey` FOREIGN KEY (`scheduleId`) REFERENCES `calibrationschedule`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `calibrationhistory` ADD CONSTRAINT `calibrationhistory_vendorId_fkey` FOREIGN KEY (`vendorId`) REFERENCES `vendor`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `calibrationhistory` ADD CONSTRAINT `calibrationhistory_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
