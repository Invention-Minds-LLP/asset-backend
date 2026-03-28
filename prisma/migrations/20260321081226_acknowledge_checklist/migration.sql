-- AlterTable
ALTER TABLE `assetacknowledgementrun` ADD COLUMN `assignmentId` INTEGER NULL,
    ADD COLUMN `transferHistoryId` INTEGER NULL;

-- AlterTable
ALTER TABLE `assetacknowledgementtemplate` ADD COLUMN `purpose` ENUM('ASSIGNMENT', 'TRANSFER_RETURN', 'TRANSFER_OUT', 'MAINTENANCE') NOT NULL DEFAULT 'ASSIGNMENT';

-- AlterTable
ALTER TABLE `assetlocation` ADD COLUMN `approvalReason` VARCHAR(191) NULL,
    ADD COLUMN `approvedAt` DATETIME(3) NULL,
    ADD COLUMN `approvedById` INTEGER NULL,
    ADD COLUMN `rejectedAt` DATETIME(3) NULL,
    ADD COLUMN `rejectedById` INTEGER NULL,
    ADD COLUMN `rejectionReason` VARCHAR(191) NULL,
    ADD COLUMN `requestReason` VARCHAR(191) NULL,
    ADD COLUMN `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN `requestedById` INTEGER NULL,
    ADD COLUMN `status` VARCHAR(191) NOT NULL DEFAULT 'REQUESTED';

-- AddForeignKey
ALTER TABLE `assetlocation` ADD CONSTRAINT `assetlocation_requestedById_fkey` FOREIGN KEY (`requestedById`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assetlocation` ADD CONSTRAINT `assetlocation_approvedById_fkey` FOREIGN KEY (`approvedById`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assetlocation` ADD CONSTRAINT `assetlocation_rejectedById_fkey` FOREIGN KEY (`rejectedById`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assetacknowledgementrun` ADD CONSTRAINT `assetacknowledgementrun_transferHistoryId_fkey` FOREIGN KEY (`transferHistoryId`) REFERENCES `assettransferhistory`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assetacknowledgementrun` ADD CONSTRAINT `assetacknowledgementrun_assignmentId_fkey` FOREIGN KEY (`assignmentId`) REFERENCES `AssetAssignment`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
