-- AlterTable
ALTER TABLE `asset` ADD COLUMN `remarks` TEXT NULL,
    ADD COLUMN `sourceReference` VARCHAR(191) NULL,
    ADD COLUMN `sourceType` VARCHAR(191) NULL;
