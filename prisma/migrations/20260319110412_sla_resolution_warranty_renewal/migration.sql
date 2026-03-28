-- DropForeignKey
ALTER TABLE `warranty` DROP FOREIGN KEY `warranty_assetId_fkey`;

-- DropIndex
DROP INDEX `warranty_assetId_key` ON `warranty`;

-- AlterTable
ALTER TABLE `asset` ADD COLUMN `slaResolutionUnit` VARCHAR(191) NULL,
    ADD COLUMN `slaResolutionValue` INTEGER NULL;

-- AlterTable
ALTER TABLE `warranty` ADD COLUMN `isActive` BOOLEAN NULL DEFAULT true;