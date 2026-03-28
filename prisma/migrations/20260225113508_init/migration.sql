-- CreateTable
CREATE TABLE `asset` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `assetId` VARCHAR(191) NOT NULL,
    `assetName` VARCHAR(191) NOT NULL,
    `assetType` VARCHAR(191) NOT NULL,
    `assetCategoryId` INTEGER NOT NULL,
    `serialNumber` VARCHAR(191) NOT NULL,
    `purchaseDate` DATETIME(3) NULL,
    `modeOfProcurement` VARCHAR(191) NOT NULL DEFAULT 'PURCHASE',
    `hasSpecifications` BOOLEAN NULL DEFAULT false,
    `invoiceNumber` VARCHAR(191) NULL,
    `purchaseOrderNo` VARCHAR(191) NULL,
    `purchaseOrderDate` DATETIME(3) NULL,
    `deliveryDate` DATETIME(3) NULL,
    `purchaseCost` DECIMAL(12, 2) NULL,
    `donorName` VARCHAR(191) NULL,
    `donationDate` DATETIME(3) NULL,
    `assetCondition` VARCHAR(191) NULL,
    `estimatedValue` DECIMAL(12, 2) NULL,
    `donationDocument` VARCHAR(191) NULL,
    `leaseStartDate` DATETIME(3) NULL,
    `leaseEndDate` DATETIME(3) NULL,
    `leaseAmount` DECIMAL(12, 2) NULL,
    `leaseRenewalDate` DATETIME(3) NULL,
    `leaseContractDoc` VARCHAR(191) NULL,
    `rentalStartDate` DATETIME(3) NULL,
    `rentalEndDate` DATETIME(3) NULL,
    `rentalAmount` DECIMAL(12, 2) NULL,
    `rentalAgreementDoc` VARCHAR(191) NULL,
    `vendorId` INTEGER NULL,
    `grnNumber` VARCHAR(191) NULL,
    `grnDate` DATETIME(3) NULL,
    `grnValue` DECIMAL(12, 2) NULL,
    `inspectionStatus` VARCHAR(191) NULL,
    `inspectionRemarks` VARCHAR(191) NULL,
    `departmentId` INTEGER NULL,
    `supervisorId` INTEGER NULL,
    `allottedToId` INTEGER NULL,
    `rfidCode` VARCHAR(191) NOT NULL,
    `qrCode` VARCHAR(191) NULL,
    `qrGeneratedAt` DATETIME(3) NULL,
    `qrLabelPrinted` BOOLEAN NULL DEFAULT false,
    `currentLocation` VARCHAR(191) NULL,
    `fromLocation` VARCHAR(191) NULL,
    `toLocation` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL,
    `assetPhoto` VARCHAR(191) NULL,
    `criticalityLevel` VARCHAR(191) NULL,
    `riskClass` VARCHAR(191) NULL,
    `workingCondition` VARCHAR(191) NULL,
    `healthScore` INTEGER NULL,
    `lastInspectionDate` DATETIME(3) NULL,
    `slaExpectedValue` INTEGER NULL,
    `slaExpectedUnit` VARCHAR(191) NULL,
    `slaNextDueAt` DATETIME(3) NULL,
    `slaBreached` BOOLEAN NULL,
    `lastSlaServiceDate` DATETIME(3) NULL,
    `retiredDate` DATETIME(3) NULL,
    `retiredReason` VARCHAR(191) NULL,
    `expectedLifetime` INTEGER NULL,
    `expectedLifetimeUnit` VARCHAR(191) NULL,
    `retiredBy` VARCHAR(191) NULL,
    `parentAssetId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdById` INTEGER NULL,
    `updatedById` INTEGER NULL,
    `employeeId` INTEGER NULL,

    UNIQUE INDEX `asset_assetId_key`(`assetId`),
    UNIQUE INDEX `asset_serialNumber_key`(`serialNumber`),
    UNIQUE INDEX `asset_rfidCode_key`(`rfidCode`),
    UNIQUE INDEX `asset_qrCode_key`(`qrCode`),
    INDEX `asset_status_idx`(`status`),
    INDEX `asset_assetCategoryId_idx`(`assetCategoryId`),
    INDEX `asset_departmentId_idx`(`departmentId`),
    INDEX `asset_vendorId_idx`(`vendorId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `warranty` (
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
    `createdById` INTEGER NULL,
    `updatedById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `warranty_assetId_key`(`assetId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ticket` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ticketId` VARCHAR(191) NOT NULL,
    `raisedById` INTEGER NULL,
    `departmentId` INTEGER NOT NULL,
    `assetId` INTEGER NOT NULL,
    `issueType` VARCHAR(191) NOT NULL,
    `detailedDesc` TEXT NOT NULL,
    `priority` VARCHAR(191) NOT NULL,
    `photoOfIssue` VARCHAR(191) NULL,
    `location` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `slaExpectedValue` INTEGER NULL,
    `slaExpectedUnit` VARCHAR(191) NULL,
    `slaResolvedAt` DATETIME(3) NULL,
    `slaBreached` BOOLEAN NULL,
    `downtimeStart` DATETIME(3) NULL,
    `downtimeEnd` DATETIME(3) NULL,
    `serviceType` VARCHAR(191) NULL,
    `serviceCost` DECIMAL(12, 2) NULL,
    `partsCost` DECIMAL(12, 2) NULL,
    `totalCost` DECIMAL(12, 2) NULL,
    `approvedBy` VARCHAR(191) NULL,
    `closedBy` VARCHAR(191) NULL,
    `closureRemarks` VARCHAR(191) NULL,
    `createdById` INTEGER NULL,
    `updatedById` INTEGER NULL,

    UNIQUE INDEX `ticket_ticketId_key`(`ticketId`),
    INDEX `ticket_assetId_createdAt_idx`(`assetId`, `createdAt`),
    INDEX `ticket_departmentId_status_idx`(`departmentId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `maintenancehistory` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `assetId` INTEGER NOT NULL,
    `scheduledDue` DATETIME(3) NOT NULL,
    `actualDoneAt` DATETIME(3) NULL,
    `wasLate` BOOLEAN NOT NULL,
    `performedBy` VARCHAR(191) NOT NULL,
    `notes` VARCHAR(191) NULL,
    `serviceReport` VARCHAR(191) NULL,
    `serviceType` VARCHAR(191) NULL,
    `serviceCost` DECIMAL(12, 2) NULL,
    `partsCost` DECIMAL(12, 2) NULL,
    `totalCost` DECIMAL(12, 2) NULL,
    `createdById` INTEGER NULL,
    `updatedById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `maintenancehistory_assetId_actualDoneAt_idx`(`assetId`, `actualDoneAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `users` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `employeeID` VARCHAR(191) NOT NULL,
    `username` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `role` VARCHAR(191) NOT NULL,
    `lastLogin` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `users_employeeID_key`(`employeeID`),
    UNIQUE INDEX `users_username_key`(`username`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `loginhistory` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `attemptedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `ipAddress` VARCHAR(191) NULL,
    `userAgent` VARCHAR(191) NULL,
    `success` BOOLEAN NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `assetcategory` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `createdById` INTEGER NULL,
    `updatedById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `assetcategory_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `department` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `createdById` INTEGER NULL,
    `updatedById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `department_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employee` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `employeeID` VARCHAR(191) NOT NULL,
    `departmentId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `employee_employeeID_key`(`employeeID`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `vendor` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `contact` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,
    `createdById` INTEGER NULL,
    `updatedById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `vendor_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ticketstatushistory` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ticketId` INTEGER NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `changedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `changedBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `assetdepreciation` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `assetId` INTEGER NOT NULL,
    `depreciationMethod` VARCHAR(191) NOT NULL,
    `depreciationRate` DECIMAL(12, 2) NOT NULL,
    `expectedLifeYears` INTEGER NOT NULL,
    `salvageValue` DECIMAL(12, 2) NULL,
    `depreciationStart` DATETIME(3) NOT NULL,
    `lastCalculatedAt` DATETIME(3) NULL,
    `accumulatedDepreciation` DECIMAL(12, 2) NULL,
    `currentBookValue` DECIMAL(12, 2) NULL,
    `depreciationFrequency` VARCHAR(191) NULL,
    `isActive` BOOLEAN NULL DEFAULT true,
    `createdById` INTEGER NULL,
    `updatedById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `assetdepreciation_assetId_key`(`assetId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `depreciationlog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `assetId` INTEGER NOT NULL,
    `periodStart` DATETIME(3) NOT NULL,
    `periodEnd` DATETIME(3) NOT NULL,
    `depreciationAmount` DECIMAL(12, 2) NOT NULL,
    `bookValueAfter` DECIMAL(12, 2) NOT NULL,
    `doneById` INTEGER NULL,
    `reason` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `depreciationlog_assetId_periodEnd_idx`(`assetId`, `periodEnd`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `assetinsurance` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `assetId` INTEGER NOT NULL,
    `provider` VARCHAR(191) NULL,
    `policyNumber` VARCHAR(191) NULL,
    `coverageAmount` DECIMAL(12, 2) NULL,
    `premiumAmount` DECIMAL(12, 2) NULL,
    `startDate` DATETIME(3) NULL,
    `endDate` DATETIME(3) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `policyType` VARCHAR(191) NULL,
    `policyStatus` VARCHAR(191) NULL,
    `renewalReminderDays` INTEGER NULL DEFAULT 30,
    `document` VARCHAR(191) NULL,
    `notes` VARCHAR(191) NULL,
    `createdById` INTEGER NULL,
    `updatedById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `assetinsurance_assetId_endDate_idx`(`assetId`, `endDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `insuranceclaim` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `assetId` INTEGER NOT NULL,
    `insuranceId` INTEGER NOT NULL,
    `claimNumber` VARCHAR(191) NOT NULL,
    `claimDate` DATETIME(3) NOT NULL,
    `claimAmount` DECIMAL(12, 2) NOT NULL,
    `approvedAmount` DECIMAL(12, 2) NULL,
    `claimStatus` VARCHAR(191) NULL,
    `reason` VARCHAR(191) NULL,
    `claimedBy` VARCHAR(191) NULL,
    `documents` VARCHAR(191) NULL,
    `settledAt` DATETIME(3) NULL,
    `createdById` INTEGER NULL,
    `updatedById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `insuranceclaim_insuranceId_claimNumber_key`(`insuranceId`, `claimNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `branch` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `createdById` INTEGER NULL,
    `updatedById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `branch_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `assetlocation` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `assetId` INTEGER NOT NULL,
    `branchId` INTEGER NOT NULL,
    `block` VARCHAR(191) NULL,
    `floor` VARCHAR(191) NULL,
    `room` VARCHAR(191) NULL,
    `employeeResponsibleId` INTEGER NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdById` INTEGER NULL,
    `updatedById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `assetlocation_assetId_isActive_idx`(`assetId`, `isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `assettransferhistory` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `assetId` INTEGER NOT NULL,
    `transferType` VARCHAR(191) NOT NULL,
    `block` VARCHAR(191) NULL,
    `floor` VARCHAR(191) NULL,
    `room` VARCHAR(191) NULL,
    `externalType` VARCHAR(191) NULL,
    `fromBranchId` INTEGER NULL,
    `toBranchId` INTEGER NULL,
    `temporary` BOOLEAN NOT NULL DEFAULT false,
    `expiresAt` DATETIME(3) NULL,
    `approvedBy` VARCHAR(191) NOT NULL,
    `transferDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `requestedBy` VARCHAR(191) NULL,
    `reason` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `maintenanceschedule` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `assetId` INTEGER NOT NULL,
    `frequencyValue` INTEGER NOT NULL,
    `frequencyUnit` VARCHAR(191) NOT NULL,
    `nextDueAt` DATETIME(3) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdBy` VARCHAR(191) NULL,
    `reason` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `maintenanceschedule_assetId_nextDueAt_idx`(`assetId`, `nextDueAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `servicecontract` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `assetId` INTEGER NOT NULL,
    `vendorId` INTEGER NULL,
    `contractType` VARCHAR(191) NOT NULL,
    `contractNumber` VARCHAR(191) NULL,
    `startDate` DATETIME(3) NOT NULL,
    `endDate` DATETIME(3) NOT NULL,
    `includesParts` BOOLEAN NULL,
    `includesLabor` BOOLEAN NULL,
    `visitsPerYear` INTEGER NULL,
    `cost` DECIMAL(12, 2) NULL,
    `currency` VARCHAR(191) NULL,
    `document` VARCHAR(191) NULL,
    `terms` TEXT NULL,
    `status` VARCHAR(191) NULL,
    `createdBy` VARCHAR(191) NULL,
    `reason` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `servicecontract_assetId_endDate_idx`(`assetId`, `endDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `gatepass` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `gatePassNo` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `assetId` INTEGER NULL,
    `description` VARCHAR(191) NULL,
    `quantity` INTEGER NULL,
    `issuedTo` VARCHAR(191) NOT NULL,
    `purpose` VARCHAR(191) NOT NULL,
    `expectedReturnDate` DATETIME(3) NULL,
    `courierDetails` VARCHAR(191) NULL,
    `vehicleNo` VARCHAR(191) NULL,
    `approvedBy` VARCHAR(191) NULL,
    `issuedBy` VARCHAR(191) NULL,
    `reason` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `gatepass_gatePassNo_key`(`gatePassNo`),
    INDEX `gatepass_assetId_createdAt_idx`(`assetId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sparepart` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `partNumber` VARCHAR(191) NULL,
    `model` VARCHAR(191) NULL,
    `category` VARCHAR(191) NULL,
    `vendorId` INTEGER NULL,
    `stockQuantity` INTEGER NOT NULL DEFAULT 0,
    `reorderLevel` INTEGER NULL DEFAULT 0,
    `cost` DECIMAL(12, 2) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdById` INTEGER NULL,
    `updatedById` INTEGER NULL,

    INDEX `sparepart_vendorId_idx`(`vendorId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sparepartusage` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `sparePartId` INTEGER NOT NULL,
    `assetId` INTEGER NOT NULL,
    `ticketId` INTEGER NULL,
    `quantity` INTEGER NOT NULL,
    `costAtUse` DECIMAL(12, 2) NULL,
    `usedById` INTEGER NULL,
    `reason` VARCHAR(191) NULL,
    `usedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `sparepartusage_assetId_usedAt_idx`(`assetId`, `usedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `consumable` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `unit` VARCHAR(191) NULL,
    `stockQuantity` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `reorderLevel` DECIMAL(12, 2) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdById` INTEGER NULL,
    `updatedById` INTEGER NULL,

    UNIQUE INDEX `consumable_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `consumablebatch` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `consumableId` INTEGER NOT NULL,
    `batchNumber` VARCHAR(191) NULL,
    `expiryDate` DATETIME(3) NULL,
    `quantity` DECIMAL(12, 2) NOT NULL,
    `remainingQuantity` DECIMAL(12, 2) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `consumablebatch_consumableId_expiryDate_idx`(`consumableId`, `expiryDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `inventorytransaction` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `type` VARCHAR(191) NOT NULL,
    `sparePartId` INTEGER NULL,
    `consumableId` INTEGER NULL,
    `quantity` DECIMAL(12, 2) NOT NULL,
    `referenceType` VARCHAR(191) NULL,
    `referenceId` INTEGER NULL,
    `performedById` INTEGER NULL,
    `notes` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `inventorytransaction_sparePartId_idx`(`sparePartId`),
    INDEX `inventorytransaction_consumableId_idx`(`consumableId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `document` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `entityType` VARCHAR(191) NOT NULL,
    `entityId` INTEGER NOT NULL,
    `documentType` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NULL,
    `fileUrl` VARCHAR(191) NOT NULL,
    `uploadedById` INTEGER NULL,
    `reason` VARCHAR(191) NULL,
    `uploadedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `assetId` INTEGER NULL,

    INDEX `document_entityType_entityId_idx`(`entityType`, `entityId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `qrscanlog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `assetId` INTEGER NOT NULL,
    `scannedById` INTEGER NULL,
    `location` VARCHAR(191) NULL,
    `action` VARCHAR(191) NULL,
    `scannedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `qrscanlog_assetId_scannedAt_idx`(`assetId`, `scannedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `assetscanlog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `assetId` INTEGER NOT NULL,
    `scannedById` INTEGER NULL,
    `scanType` VARCHAR(191) NULL,
    `location` VARCHAR(191) NULL,
    `notes` VARCHAR(191) NULL,
    `scannedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `assetscanlog_assetId_scannedAt_idx`(`assetId`, `scannedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notification` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `assetId` INTEGER NULL,
    `ticketId` INTEGER NULL,
    `gatePassId` INTEGER NULL,
    `insuranceId` INTEGER NULL,
    `claimId` INTEGER NULL,
    `type` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NULL,
    `message` TEXT NOT NULL,
    `createdById` INTEGER NULL,
    `employeeId` INTEGER NULL,
    `priority` VARCHAR(191) NULL,
    `channel` VARCHAR(191) NULL,
    `dedupeKey` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `notification_dedupeKey_key`(`dedupeKey`),
    INDEX `notification_assetId_createdAt_idx`(`assetId`, `createdAt`),
    INDEX `notification_ticketId_createdAt_idx`(`ticketId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notificationrecipient` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `notificationId` INTEGER NOT NULL,
    `employeeId` INTEGER NOT NULL,
    `isRead` BOOLEAN NOT NULL DEFAULT false,
    `readAt` DATETIME(3) NULL,
    `deliveryStatus` VARCHAR(191) NULL,
    `deliveredAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `notificationrecipient_employeeId_isRead_createdAt_idx`(`employeeId`, `isRead`, `createdAt`),
    UNIQUE INDEX `notificationrecipient_notificationId_employeeId_key`(`notificationId`, `employeeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AssetAssignment` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `assetId` INTEGER NOT NULL,
    `assignedToId` INTEGER NOT NULL,
    `assignedById` INTEGER NULL,
    `status` ENUM('PENDING', 'ACKNOWLEDGED', 'REJECTED', 'RETURNED') NOT NULL DEFAULT 'PENDING',
    `acknowledgedAt` DATETIME(3) NULL,
    `rejectedAt` DATETIME(3) NULL,
    `rejectionReason` VARCHAR(191) NULL,
    `acknowledgementNote` VARCHAR(191) NULL,
    `digitalSignature` VARCHAR(191) NULL,
    `photoProof` VARCHAR(191) NULL,
    `conditionAtHandover` VARCHAR(191) NULL,
    `assignedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `returnedAt` DATETIME(3) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `employeeId` INTEGER NULL,

    INDEX `AssetAssignment_assetId_isActive_idx`(`assetId`, `isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AssetAssignmentHistory` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `assignmentId` INTEGER NOT NULL,
    `action` ENUM('CREATED', 'ACKNOWLEDGED', 'REJECTED', 'REASSIGNED', 'RETURNED') NOT NULL,
    `performedById` INTEGER NULL,
    `notes` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AssetSpecification` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `assetId` INTEGER NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `value` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AssetSpecification_assetId_idx`(`assetId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EscalationMatrix` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `departmentId` INTEGER NULL,
    `assetCategoryId` INTEGER NULL,
    `priority` VARCHAR(191) NOT NULL,
    `level` INTEGER NOT NULL,
    `escalateAfterValue` INTEGER NOT NULL,
    `escalateAfterUnit` VARCHAR(191) NOT NULL,
    `notifyRole` VARCHAR(191) NULL,
    `notifyEmployeeId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `EscalationMatrix_departmentId_assetCategoryId_priority_idx`(`departmentId`, `assetCategoryId`, `priority`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TicketEscalation` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ticketId` INTEGER NOT NULL,
    `level` INTEGER NOT NULL,
    `escalatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `notifiedEmployeeId` INTEGER NULL,
    `message` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `TicketEscalation_ticketId_level_idx`(`ticketId`, `level`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `asset` ADD CONSTRAINT `asset_assetCategoryId_fkey` FOREIGN KEY (`assetCategoryId`) REFERENCES `assetcategory`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asset` ADD CONSTRAINT `asset_vendorId_fkey` FOREIGN KEY (`vendorId`) REFERENCES `vendor`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asset` ADD CONSTRAINT `asset_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `department`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asset` ADD CONSTRAINT `asset_supervisorId_fkey` FOREIGN KEY (`supervisorId`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asset` ADD CONSTRAINT `asset_allottedToId_fkey` FOREIGN KEY (`allottedToId`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asset` ADD CONSTRAINT `asset_parentAssetId_fkey` FOREIGN KEY (`parentAssetId`) REFERENCES `asset`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asset` ADD CONSTRAINT `asset_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `warranty` ADD CONSTRAINT `warranty_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `asset`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ticket` ADD CONSTRAINT `ticket_raisedById_fkey` FOREIGN KEY (`raisedById`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ticket` ADD CONSTRAINT `ticket_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `department`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ticket` ADD CONSTRAINT `ticket_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `asset`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `maintenancehistory` ADD CONSTRAINT `maintenancehistory_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `asset`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_employeeID_fkey` FOREIGN KEY (`employeeID`) REFERENCES `employee`(`employeeID`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `loginhistory` ADD CONSTRAINT `loginhistory_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employee` ADD CONSTRAINT `employee_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `department`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ticketstatushistory` ADD CONSTRAINT `ticketstatushistory_ticketId_fkey` FOREIGN KEY (`ticketId`) REFERENCES `ticket`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assetdepreciation` ADD CONSTRAINT `assetdepreciation_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `asset`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `depreciationlog` ADD CONSTRAINT `depreciationlog_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `asset`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `depreciationlog` ADD CONSTRAINT `depreciationlog_doneById_fkey` FOREIGN KEY (`doneById`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assetinsurance` ADD CONSTRAINT `assetinsurance_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `asset`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `insuranceclaim` ADD CONSTRAINT `insuranceclaim_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `asset`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `insuranceclaim` ADD CONSTRAINT `insuranceclaim_insuranceId_fkey` FOREIGN KEY (`insuranceId`) REFERENCES `assetinsurance`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assetlocation` ADD CONSTRAINT `assetlocation_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `asset`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assetlocation` ADD CONSTRAINT `assetlocation_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assetlocation` ADD CONSTRAINT `assetlocation_employeeResponsibleId_fkey` FOREIGN KEY (`employeeResponsibleId`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assettransferhistory` ADD CONSTRAINT `assettransferhistory_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `asset`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assettransferhistory` ADD CONSTRAINT `assettransferhistory_fromBranchId_fkey` FOREIGN KEY (`fromBranchId`) REFERENCES `branch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assettransferhistory` ADD CONSTRAINT `assettransferhistory_toBranchId_fkey` FOREIGN KEY (`toBranchId`) REFERENCES `branch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `maintenanceschedule` ADD CONSTRAINT `maintenanceschedule_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `asset`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `servicecontract` ADD CONSTRAINT `servicecontract_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `asset`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `servicecontract` ADD CONSTRAINT `servicecontract_vendorId_fkey` FOREIGN KEY (`vendorId`) REFERENCES `vendor`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `gatepass` ADD CONSTRAINT `gatepass_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `asset`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sparepart` ADD CONSTRAINT `sparepart_vendorId_fkey` FOREIGN KEY (`vendorId`) REFERENCES `vendor`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sparepartusage` ADD CONSTRAINT `sparepartusage_sparePartId_fkey` FOREIGN KEY (`sparePartId`) REFERENCES `sparepart`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sparepartusage` ADD CONSTRAINT `sparepartusage_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `asset`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sparepartusage` ADD CONSTRAINT `sparepartusage_ticketId_fkey` FOREIGN KEY (`ticketId`) REFERENCES `ticket`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sparepartusage` ADD CONSTRAINT `sparepartusage_usedById_fkey` FOREIGN KEY (`usedById`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `consumablebatch` ADD CONSTRAINT `consumablebatch_consumableId_fkey` FOREIGN KEY (`consumableId`) REFERENCES `consumable`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventorytransaction` ADD CONSTRAINT `inventorytransaction_sparePartId_fkey` FOREIGN KEY (`sparePartId`) REFERENCES `sparepart`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventorytransaction` ADD CONSTRAINT `inventorytransaction_consumableId_fkey` FOREIGN KEY (`consumableId`) REFERENCES `consumable`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventorytransaction` ADD CONSTRAINT `inventorytransaction_performedById_fkey` FOREIGN KEY (`performedById`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `document` ADD CONSTRAINT `document_uploadedById_fkey` FOREIGN KEY (`uploadedById`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `document` ADD CONSTRAINT `document_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `asset`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `qrscanlog` ADD CONSTRAINT `qrscanlog_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `asset`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `qrscanlog` ADD CONSTRAINT `qrscanlog_scannedById_fkey` FOREIGN KEY (`scannedById`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assetscanlog` ADD CONSTRAINT `assetscanlog_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `asset`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assetscanlog` ADD CONSTRAINT `assetscanlog_scannedById_fkey` FOREIGN KEY (`scannedById`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification` ADD CONSTRAINT `notification_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `asset`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification` ADD CONSTRAINT `notification_ticketId_fkey` FOREIGN KEY (`ticketId`) REFERENCES `ticket`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification` ADD CONSTRAINT `notification_gatePassId_fkey` FOREIGN KEY (`gatePassId`) REFERENCES `gatepass`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification` ADD CONSTRAINT `notification_insuranceId_fkey` FOREIGN KEY (`insuranceId`) REFERENCES `assetinsurance`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification` ADD CONSTRAINT `notification_claimId_fkey` FOREIGN KEY (`claimId`) REFERENCES `insuranceclaim`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification` ADD CONSTRAINT `notification_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification` ADD CONSTRAINT `notification_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notificationrecipient` ADD CONSTRAINT `notificationrecipient_notificationId_fkey` FOREIGN KEY (`notificationId`) REFERENCES `notification`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notificationrecipient` ADD CONSTRAINT `notificationrecipient_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssetAssignment` ADD CONSTRAINT `AssetAssignment_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `asset`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssetAssignment` ADD CONSTRAINT `AssetAssignment_assignedToId_fkey` FOREIGN KEY (`assignedToId`) REFERENCES `employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssetAssignment` ADD CONSTRAINT `AssetAssignment_assignedById_fkey` FOREIGN KEY (`assignedById`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssetAssignment` ADD CONSTRAINT `AssetAssignment_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssetAssignmentHistory` ADD CONSTRAINT `AssetAssignmentHistory_assignmentId_fkey` FOREIGN KEY (`assignmentId`) REFERENCES `AssetAssignment`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssetAssignmentHistory` ADD CONSTRAINT `AssetAssignmentHistory_performedById_fkey` FOREIGN KEY (`performedById`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssetSpecification` ADD CONSTRAINT `AssetSpecification_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `asset`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EscalationMatrix` ADD CONSTRAINT `EscalationMatrix_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `department`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EscalationMatrix` ADD CONSTRAINT `EscalationMatrix_assetCategoryId_fkey` FOREIGN KEY (`assetCategoryId`) REFERENCES `assetcategory`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EscalationMatrix` ADD CONSTRAINT `EscalationMatrix_notifyEmployeeId_fkey` FOREIGN KEY (`notifyEmployeeId`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TicketEscalation` ADD CONSTRAINT `TicketEscalation_ticketId_fkey` FOREIGN KEY (`ticketId`) REFERENCES `ticket`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TicketEscalation` ADD CONSTRAINT `TicketEscalation_notifiedEmployeeId_fkey` FOREIGN KEY (`notifiedEmployeeId`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
