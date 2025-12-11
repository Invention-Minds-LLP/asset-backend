-- AlterTable
ALTER TABLE `asset` ADD COLUMN `expectedLifetime` INTEGER NULL,
    ADD COLUMN `expectedLifetimeUnit` VARCHAR(191) NULL,
    ADD COLUMN `retiredBy` VARCHAR(191) NULL,
    ADD COLUMN `retiredDate` DATETIME(3) NULL,
    ADD COLUMN `retiredReason` VARCHAR(191) NULL;
