-- AlterTable
ALTER TABLE `asset` ADD COLUMN `slaCategory` ENUM('LOW', 'MEDIUM', 'HIGH') NULL;

-- AlterTable
ALTER TABLE `ticket` ADD COLUMN `currentSlaLevel` ENUM('L1', 'L2', 'L3') NULL,
    ADD COLUMN `slaCategory` ENUM('LOW', 'MEDIUM', 'HIGH') NULL;

-- CreateTable
CREATE TABLE `assetslamatrix` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `assetCategoryId` INTEGER NULL,
    `slaCategory` ENUM('LOW', 'MEDIUM', 'HIGH') NOT NULL,
    `level` ENUM('L1', 'L2', 'L3') NOT NULL,
    `responseTimeValue` INTEGER NOT NULL,
    `responseTimeUnit` VARCHAR(191) NOT NULL,
    `resolutionTimeValue` INTEGER NOT NULL,
    `resolutionTimeUnit` VARCHAR(191) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `assetslamatrix` ADD CONSTRAINT `assetslamatrix_assetCategoryId_fkey` FOREIGN KEY (`assetCategoryId`) REFERENCES `assetcategory`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
