/*
  Warnings:

  - Added the required column `stage` to the `AssetAssignment` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `AssetAssignment` ADD COLUMN `stage` ENUM('HOD_SOURCE', 'SUPERVISOR', 'HOD_TARGET', 'END_USER') NOT NULL;

-- AlterTable
ALTER TABLE `asset` ADD COLUMN `targetDepartmentId` INTEGER NULL,
    MODIFY `rfidCode` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `employee` ADD COLUMN `role` ENUM('HOD', 'SUPERVISOR', 'EXECUTIVE') NOT NULL DEFAULT 'EXECUTIVE';

-- AddForeignKey
ALTER TABLE `asset` ADD CONSTRAINT `asset_targetDepartmentId_fkey` FOREIGN KEY (`targetDepartmentId`) REFERENCES `department`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
