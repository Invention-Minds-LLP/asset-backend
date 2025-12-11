-- DropForeignKey
ALTER TABLE `asset` DROP FOREIGN KEY `Asset_allottedToId_fkey`;

-- DropForeignKey
ALTER TABLE `asset` DROP FOREIGN KEY `Asset_departmentId_fkey`;

-- DropForeignKey
ALTER TABLE `asset` DROP FOREIGN KEY `Asset_vendorId_fkey`;

-- DropIndex
DROP INDEX `Asset_allottedToId_fkey` ON `asset`;

-- DropIndex
DROP INDEX `Asset_departmentId_fkey` ON `asset`;

-- DropIndex
DROP INDEX `Asset_vendorId_fkey` ON `asset`;

-- AlterTable
ALTER TABLE `asset` ADD COLUMN `assetCondition` VARCHAR(191) NULL,
    ADD COLUMN `deliveryDate` DATETIME(3) NULL,
    ADD COLUMN `donationDate` DATETIME(3) NULL,
    ADD COLUMN `donationDocument` VARCHAR(191) NULL,
    ADD COLUMN `donorName` VARCHAR(191) NULL,
    ADD COLUMN `estimatedValue` DOUBLE NULL,
    ADD COLUMN `grnDate` DATETIME(3) NULL,
    ADD COLUMN `grnNumber` VARCHAR(191) NULL,
    ADD COLUMN `grnValue` DOUBLE NULL,
    ADD COLUMN `inspectionRemarks` VARCHAR(191) NULL,
    ADD COLUMN `inspectionStatus` VARCHAR(191) NULL,
    ADD COLUMN `invoiceNumber` VARCHAR(191) NULL,
    ADD COLUMN `leaseAmount` DOUBLE NULL,
    ADD COLUMN `leaseContractDoc` VARCHAR(191) NULL,
    ADD COLUMN `leaseEndDate` DATETIME(3) NULL,
    ADD COLUMN `leaseRenewalDate` DATETIME(3) NULL,
    ADD COLUMN `leaseStartDate` DATETIME(3) NULL,
    ADD COLUMN `modeOfProcurement` VARCHAR(191) NOT NULL DEFAULT 'PURCHASE',
    ADD COLUMN `purchaseCost` DOUBLE NULL,
    ADD COLUMN `purchaseOrderDate` DATETIME(3) NULL,
    ADD COLUMN `purchaseOrderNo` VARCHAR(191) NULL,
    ADD COLUMN `rentalAgreementDoc` VARCHAR(191) NULL,
    ADD COLUMN `rentalAmount` DOUBLE NULL,
    ADD COLUMN `rentalEndDate` DATETIME(3) NULL,
    ADD COLUMN `rentalStartDate` DATETIME(3) NULL,
    MODIFY `purchaseDate` DATETIME(3) NULL,
    MODIFY `vendorId` INTEGER NULL,
    MODIFY `departmentId` INTEGER NULL,
    MODIFY `allottedToId` INTEGER NULL;

-- CreateTable
CREATE TABLE `AssetDepreciation` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `assetId` INTEGER NOT NULL,
    `depreciationMethod` VARCHAR(191) NOT NULL,
    `depreciationRate` DOUBLE NOT NULL,
    `expectedLifeYears` INTEGER NOT NULL,
    `salvageValue` DOUBLE NULL,
    `depreciationStart` DATETIME(3) NOT NULL,
    `lastCalculatedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `AssetDepreciation_assetId_key`(`assetId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AssetInsurance` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `assetId` INTEGER NOT NULL,
    `provider` VARCHAR(191) NULL,
    `policyNumber` VARCHAR(191) NULL,
    `coverageAmount` DOUBLE NULL,
    `premiumAmount` DOUBLE NULL,
    `startDate` DATETIME(3) NULL,
    `endDate` DATETIME(3) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `document` VARCHAR(191) NULL,
    `notes` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Branch` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Branch_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AssetLocation` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `assetId` INTEGER NOT NULL,
    `branchId` INTEGER NOT NULL,
    `block` VARCHAR(191) NULL,
    `floor` VARCHAR(191) NULL,
    `room` VARCHAR(191) NULL,
    `employeeResponsibleId` INTEGER NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AssetTransferHistory` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `assetId` INTEGER NOT NULL,
    `fromBranchId` INTEGER NULL,
    `toBranchId` INTEGER NOT NULL,
    `temporary` BOOLEAN NOT NULL DEFAULT false,
    `expiresAt` DATETIME(3) NULL,
    `approvedBy` VARCHAR(191) NOT NULL,
    `transferDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Asset` ADD CONSTRAINT `Asset_vendorId_fkey` FOREIGN KEY (`vendorId`) REFERENCES `Vendor`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Asset` ADD CONSTRAINT `Asset_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `Department`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Asset` ADD CONSTRAINT `Asset_allottedToId_fkey` FOREIGN KEY (`allottedToId`) REFERENCES `Employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssetDepreciation` ADD CONSTRAINT `AssetDepreciation_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `Asset`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssetInsurance` ADD CONSTRAINT `AssetInsurance_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `Asset`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssetLocation` ADD CONSTRAINT `AssetLocation_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `Asset`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssetLocation` ADD CONSTRAINT `AssetLocation_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssetLocation` ADD CONSTRAINT `AssetLocation_employeeResponsibleId_fkey` FOREIGN KEY (`employeeResponsibleId`) REFERENCES `Employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssetTransferHistory` ADD CONSTRAINT `AssetTransferHistory_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `Asset`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssetTransferHistory` ADD CONSTRAINT `AssetTransferHistory_fromBranchId_fkey` FOREIGN KEY (`fromBranchId`) REFERENCES `Branch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssetTransferHistory` ADD CONSTRAINT `AssetTransferHistory_toBranchId_fkey` FOREIGN KEY (`toBranchId`) REFERENCES `Branch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
