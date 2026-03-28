/*
  Warnings:

  - You are about to drop the column `approvedBy` on the `assettransferhistory` table. All the data in the column will be lost.
  - You are about to drop the column `requestedBy` on the `assettransferhistory` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE `assettransferhistory` DROP COLUMN `approvedBy`,
    DROP COLUMN `requestedBy`,
    ADD COLUMN `approvalReason` TEXT NULL,
    ADD COLUMN `approvedAt` DATETIME(3) NULL,
    ADD COLUMN `approvedById` INTEGER NULL,
    ADD COLUMN `destinationAddress` VARCHAR(191) NULL,
    ADD COLUMN `destinationContactNumber` VARCHAR(191) NULL,
    ADD COLUMN `destinationContactPerson` VARCHAR(191) NULL,
    ADD COLUMN `destinationName` VARCHAR(191) NULL,
    ADD COLUMN `destinationType` VARCHAR(191) NULL,
    ADD COLUMN `parentTransferId` INTEGER NULL,
    ADD COLUMN `rejectedAt` DATETIME(3) NULL,
    ADD COLUMN `rejectionReason` TEXT NULL,
    ADD COLUMN `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN `requestedById` INTEGER NULL,
    ADD COLUMN `returnReason` TEXT NULL,
    ADD COLUMN `returnedAt` DATETIME(3) NULL,
    ADD COLUMN `status` VARCHAR(191) NOT NULL DEFAULT 'REQUESTED';

-- AddForeignKey
ALTER TABLE `assettransferhistory` ADD CONSTRAINT `assettransferhistory_requestedById_fkey` FOREIGN KEY (`requestedById`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assettransferhistory` ADD CONSTRAINT `assettransferhistory_approvedById_fkey` FOREIGN KEY (`approvedById`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assettransferhistory` ADD CONSTRAINT `assettransferhistory_parentTransferId_fkey` FOREIGN KEY (`parentTransferId`) REFERENCES `assettransferhistory`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
