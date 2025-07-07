-- CreateTable
CREATE TABLE `Asset` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `assetId` VARCHAR(191) NOT NULL,
    `assetName` VARCHAR(191) NOT NULL,
    `assetType` VARCHAR(191) NOT NULL,
    `assetCategoryId` INTEGER NOT NULL,
    `serialNumber` VARCHAR(191) NOT NULL,
    `purchaseDate` DATETIME(3) NOT NULL,
    `vendorId` INTEGER NOT NULL,
    `departmentId` INTEGER NOT NULL,
    `allottedToId` INTEGER NOT NULL,
    `rfidCode` VARCHAR(191) NOT NULL,
    `currentLocation` VARCHAR(191) NULL,
    `fromLocation` VARCHAR(191) NULL,
    `toLocation` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL,
    `assetPhoto` VARCHAR(191) NULL,
    `slaExpectedValue` INTEGER NULL,
    `slaExpectedUnit` VARCHAR(191) NULL,
    `slaNextDueAt` DATETIME(3) NULL,
    `slaBreached` BOOLEAN NULL,
    `lastSlaServiceDate` DATETIME(3) NULL,

    UNIQUE INDEX `Asset_assetId_key`(`assetId`),
    UNIQUE INDEX `Asset_serialNumber_key`(`serialNumber`),
    UNIQUE INDEX `Asset_rfidCode_key`(`rfidCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Warranty` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `assetId` INTEGER NOT NULL,
    `warrantyStart` DATETIME(3) NOT NULL,
    `warrantyEnd` DATETIME(3) NOT NULL,
    `daysToExpiry` INTEGER NULL,
    `isUnderWarranty` BOOLEAN NOT NULL,
    `amcActive` BOOLEAN NOT NULL,
    `amcVendor` VARCHAR(191) NULL,
    `amcStart` DATETIME(3) NULL,
    `amcEnd` DATETIME(3) NULL,
    `amcVisitsDue` INTEGER NULL,
    `lastServiceDate` DATETIME(3) NULL,
    `nextVisitDue` DATETIME(3) NULL,
    `serviceReport` VARCHAR(191) NULL,
    `alertSent` BOOLEAN NOT NULL DEFAULT false,

    UNIQUE INDEX `Warranty_assetId_key`(`assetId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Ticket` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ticketId` VARCHAR(191) NOT NULL,
    `raisedBy` VARCHAR(191) NOT NULL,
    `departmentId` INTEGER NOT NULL,
    `assetId` INTEGER NOT NULL,
    `issueType` VARCHAR(191) NOT NULL,
    `detailedDesc` TEXT NOT NULL,
    `priority` VARCHAR(191) NOT NULL,
    `photoOfIssue` VARCHAR(191) NULL,
    `location` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `slaExpectedValue` INTEGER NULL,
    `slaExpectedUnit` VARCHAR(191) NULL,
    `slaResolvedAt` DATETIME(3) NULL,
    `slaBreached` BOOLEAN NULL,

    UNIQUE INDEX `Ticket_ticketId_key`(`ticketId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MaintenanceHistory` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `assetId` INTEGER NOT NULL,
    `scheduledDue` DATETIME(3) NOT NULL,
    `actualDoneAt` DATETIME(3) NOT NULL,
    `wasLate` BOOLEAN NOT NULL,
    `performedBy` VARCHAR(191) NOT NULL,
    `notes` VARCHAR(191) NULL,
    `serviceReport` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `User` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `employeeId` INTEGER NOT NULL,
    `username` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `role` VARCHAR(191) NOT NULL,
    `lastLogin` DATETIME(3) NULL,

    UNIQUE INDEX `User_employeeId_key`(`employeeId`),
    UNIQUE INDEX `User_username_key`(`username`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LoginHistory` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `attemptedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `ipAddress` VARCHAR(191) NULL,
    `userAgent` VARCHAR(191) NULL,
    `success` BOOLEAN NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AssetCategory` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `AssetCategory_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Department` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `Department_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Employee` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Vendor` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `contact` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,

    UNIQUE INDEX `Vendor_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Asset` ADD CONSTRAINT `Asset_assetCategoryId_fkey` FOREIGN KEY (`assetCategoryId`) REFERENCES `AssetCategory`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Asset` ADD CONSTRAINT `Asset_vendorId_fkey` FOREIGN KEY (`vendorId`) REFERENCES `Vendor`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Asset` ADD CONSTRAINT `Asset_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `Department`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Asset` ADD CONSTRAINT `Asset_allottedToId_fkey` FOREIGN KEY (`allottedToId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Warranty` ADD CONSTRAINT `Warranty_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `Asset`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Ticket` ADD CONSTRAINT `Ticket_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `Department`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Ticket` ADD CONSTRAINT `Ticket_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `Asset`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MaintenanceHistory` ADD CONSTRAINT `MaintenanceHistory_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `Asset`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LoginHistory` ADD CONSTRAINT `LoginHistory_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
