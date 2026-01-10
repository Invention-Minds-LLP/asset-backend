/*
  Warnings:

  - Added the required column `transferType` to the `AssetTransferHistory` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE `assettransferhistory` DROP FOREIGN KEY `AssetTransferHistory_toBranchId_fkey`;

-- DropIndex
DROP INDEX `AssetTransferHistory_toBranchId_fkey` ON `assettransferhistory`;

-- AlterTable
ALTER TABLE `assettransferhistory` ADD COLUMN `block` VARCHAR(191) NULL,
    ADD COLUMN `externalType` VARCHAR(191) NULL,
    ADD COLUMN `floor` VARCHAR(191) NULL,
    ADD COLUMN `room` VARCHAR(191) NULL,
    ADD COLUMN `transferType` VARCHAR(191) NOT NULL,
    MODIFY `toBranchId` INTEGER NULL;

-- AddForeignKey
ALTER TABLE `AssetTransferHistory` ADD CONSTRAINT `AssetTransferHistory_toBranchId_fkey` FOREIGN KEY (`toBranchId`) REFERENCES `Branch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
