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
    `digitalSignature` LONGTEXT NULL,
    `photoProof` VARCHAR(191) NULL,
    `conditionAtHandover` VARCHAR(191) NULL,
    `assignedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `returnedAt` DATETIME(3) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `employeeId` INTEGER NULL,
    `stage` ENUM('HOD_SOURCE', 'SUPERVISOR', 'HOD_TARGET', 'END_USER') NOT NULL,

    INDEX `AssetAssignment_assetId_isActive_idx`(`assetId` ASC, `isActive` ASC),
    INDEX `AssetAssignment_assignedById_fkey`(`assignedById` ASC),
    INDEX `AssetAssignment_assignedToId_fkey`(`assignedToId` ASC),
    INDEX `AssetAssignment_employeeId_fkey`(`employeeId` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AssetAssignmentHistory` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `assignmentId` INTEGER NOT NULL,
    `action` ENUM('CREATED', 'ACKNOWLEDGED', 'REJECTED', 'REASSIGNED', 'RETURNED') NOT NULL,
    `performedById` INTEGER NULL,
    `notes` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AssetAssignmentHistory_assignmentId_fkey`(`assignmentId` ASC),
    INDEX `AssetAssignmentHistory_performedById_fkey`(`performedById` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AssetSpecification` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `assetId` INTEGER NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `value` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `isMandatory` BOOLEAN NULL DEFAULT false,
    `remarks` TEXT NULL,
    `sortOrder` INTEGER NULL DEFAULT 0,
    `source` VARCHAR(191) NULL,
    `specificationGroup` VARCHAR(191) NULL,
    `unit` VARCHAR(191) NULL,
    `valueType` VARCHAR(191) NULL,

    INDEX `AssetSpecification_assetId_idx`(`assetId` ASC),
    PRIMARY KEY (`id` ASC)
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
    `applicableTo` VARCHAR(191) NULL,
    `slaType` VARCHAR(191) NULL,
    `vendorContactEmail` VARCHAR(191) NULL,
    `vendorContactName` VARCHAR(191) NULL,
    `vendorContactPhone` VARCHAR(191) NULL,

    INDEX `EscalationMatrix_assetCategoryId_fkey`(`assetCategoryId` ASC),
    INDEX `EscalationMatrix_departmentId_assetCategoryId_priority_idx`(`departmentId` ASC, `assetCategoryId` ASC, `priority` ASC),
    INDEX `EscalationMatrix_notifyEmployeeId_fkey`(`notifyEmployeeId` ASC),
    PRIMARY KEY (`id` ASC)
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

    INDEX `TicketEscalation_notifiedEmployeeId_fkey`(`notifiedEmployeeId` ASC),
    INDEX `TicketEscalation_ticketId_level_idx`(`ticketId` ASC, `level` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `appmodule` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `icon` VARCHAR(191) NULL,
    `path` VARCHAR(191) NULL,
    `sortOrder` INTEGER NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `appmodule_name_key`(`name` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `appmoduleitem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `moduleId` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `path` VARCHAR(191) NULL,
    `icon` VARCHAR(191) NULL,
    `sortOrder` INTEGER NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `appmoduleitem_moduleId_name_key`(`moduleId` ASC, `name` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

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
    `rfidCode` VARCHAR(191) NULL,
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
    `installedAt` DATETIME(3) NULL,
    `targetDepartmentId` INTEGER NULL,
    `customDetails` TEXT NULL,
    `isAssembled` BOOLEAN NULL DEFAULT false,
    `isBranded` BOOLEAN NULL DEFAULT false,
    `isCustomized` BOOLEAN NULL DEFAULT false,
    `organogramNotes` TEXT NULL,
    `pmFormatNotes` TEXT NULL,
    `referenceCode` VARCHAR(191) NULL,
    `specificationSummary` TEXT NULL,
    `ticketHierarchyNotes` TEXT NULL,
    `remarks` TEXT NULL,
    `sourceReference` VARCHAR(191) NULL,
    `sourceType` VARCHAR(191) NULL,
    `slaCategory` ENUM('LOW', 'MEDIUM', 'HIGH') NULL,
    `slaResolutionUnit` VARCHAR(191) NULL,
    `slaResolutionValue` INTEGER NULL,
    `auditedBy` VARCHAR(191) NULL,
    `countryOfOrigin` VARCHAR(191) NULL,
    `disposalApprovedBy` VARCHAR(191) NULL,
    `disposalCertificate` VARCHAR(191) NULL,
    `disposalDate` DATETIME(3) NULL,
    `disposalMethod` VARCHAR(191) NULL,
    `disposalValue` DECIMAL(12, 2) NULL,
    `lastAuditDate` DATETIME(3) NULL,
    `manufacturer` VARCHAR(191) NULL,
    `modelNumber` VARCHAR(191) NULL,
    `physicalCondition` VARCHAR(191) NULL,
    `regulatoryApproval` VARCHAR(191) NULL,
    `warrantyStatus` VARCHAR(191) NULL,

    INDEX `asset_allottedToId_fkey`(`allottedToId` ASC),
    INDEX `asset_assetCategoryId_idx`(`assetCategoryId` ASC),
    UNIQUE INDEX `asset_assetId_key`(`assetId` ASC),
    INDEX `asset_departmentId_idx`(`departmentId` ASC),
    INDEX `asset_employeeId_fkey`(`employeeId` ASC),
    INDEX `asset_parentAssetId_fkey`(`parentAssetId` ASC),
    UNIQUE INDEX `asset_qrCode_key`(`qrCode` ASC),
    UNIQUE INDEX `asset_referenceCode_key`(`referenceCode` ASC),
    UNIQUE INDEX `asset_rfidCode_key`(`rfidCode` ASC),
    UNIQUE INDEX `asset_serialNumber_key`(`serialNumber` ASC),
    INDEX `asset_status_idx`(`status` ASC),
    INDEX `asset_supervisorId_fkey`(`supervisorId` ASC),
    INDEX `asset_targetDepartmentId_fkey`(`targetDepartmentId` ASC),
    INDEX `asset_vendorId_idx`(`vendorId` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `assetacknowledgementitem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `templateId` INTEGER NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isRequired` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `assetacknowledgementitem_templateId_sortOrder_idx`(`templateId` ASC, `sortOrder` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `assetacknowledgementresult` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `runId` INTEGER NOT NULL,
    `itemId` INTEGER NOT NULL,
    `checked` BOOLEAN NOT NULL DEFAULT false,
    `remarks` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `assetacknowledgementresult_itemId_fkey`(`itemId` ASC),
    UNIQUE INDEX `assetacknowledgementresult_runId_itemId_key`(`runId` ASC, `itemId` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `assetacknowledgementrun` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `assetId` INTEGER NOT NULL,
    `templateId` INTEGER NULL,
    `assignedToId` INTEGER NULL,
    `acknowledgedAt` DATETIME(3) NULL,
    `acknowledgedBy` VARCHAR(191) NULL,
    `remarks` TEXT NULL,
    `digitalSignature` LONGTEXT NULL,
    `photoProof` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `assignmentId` INTEGER NULL,
    `transferHistoryId` INTEGER NULL,

    INDEX `assetacknowledgementrun_assetId_createdAt_idx`(`assetId` ASC, `createdAt` ASC),
    INDEX `assetacknowledgementrun_assignedToId_fkey`(`assignedToId` ASC),
    INDEX `assetacknowledgementrun_assignmentId_fkey`(`assignmentId` ASC),
    INDEX `assetacknowledgementrun_templateId_fkey`(`templateId` ASC),
    INDEX `assetacknowledgementrun_transferHistoryId_fkey`(`transferHistoryId` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `assetacknowledgementtemplate` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `assetCategoryId` INTEGER NULL,
    `assetId` INTEGER NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `purpose` ENUM('ASSIGNMENT', 'TRANSFER_RETURN', 'TRANSFER_OUT', 'MAINTENANCE') NOT NULL DEFAULT 'ASSIGNMENT',

    INDEX `assetacknowledgementtemplate_assetCategoryId_idx`(`assetCategoryId` ASC),
    INDEX `assetacknowledgementtemplate_assetId_idx`(`assetId` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `assetaudit` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `auditName` VARCHAR(191) NOT NULL,
    `auditDate` DATETIME(3) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PLANNED',
    `departmentId` INTEGER NULL,
    `branchId` INTEGER NULL,
    `conductedById` INTEGER NULL,
    `remarks` TEXT NULL,
    `totalAssets` INTEGER NOT NULL DEFAULT 0,
    `verifiedCount` INTEGER NOT NULL DEFAULT 0,
    `missingCount` INTEGER NOT NULL DEFAULT 0,
    `mismatchCount` INTEGER NOT NULL DEFAULT 0,
    `completedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `assetaudititem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `auditId` INTEGER NOT NULL,
    `assetId` INTEGER NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `scannedAt` DATETIME(3) NULL,
    `locationMatch` BOOLEAN NULL,
    `conditionMatch` BOOLEAN NULL,
    `actualLocation` VARCHAR(191) NULL,
    `actualCondition` VARCHAR(191) NULL,
    `remarks` VARCHAR(191) NULL,
    `verifiedById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `assetaudititem_assetId_idx`(`assetId` ASC),
    INDEX `assetaudititem_auditId_status_idx`(`auditId` ASC, `status` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `assetcategory` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `createdById` INTEGER NULL,
    `updatedById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `code` VARCHAR(191) NULL,
    `description` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `assetcategory_code_key`(`code` ASC),
    UNIQUE INDEX `assetcategory_name_key`(`name` ASC),
    PRIMARY KEY (`id` ASC)
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

    UNIQUE INDEX `assetdepreciation_assetId_key`(`assetId` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `assetdisposal` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `assetId` INTEGER NOT NULL,
    `disposalType` VARCHAR(191) NOT NULL,
    `reason` TEXT NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'REQUESTED',
    `estimatedScrapValue` DECIMAL(12, 2) NULL,
    `actualSaleValue` DECIMAL(12, 2) NULL,
    `buyerName` VARCHAR(191) NULL,
    `buyerContact` VARCHAR(191) NULL,
    `committeeMembers` TEXT NULL,
    `committeeRemarks` TEXT NULL,
    `committeeApprovalDate` DATETIME(3) NULL,
    `requestedById` INTEGER NULL,
    `approvedById` INTEGER NULL,
    `completedById` INTEGER NULL,
    `certificateUrl` VARCHAR(191) NULL,
    `documents` TEXT NULL,
    `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `approvedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `rejectedAt` DATETIME(3) NULL,
    `rejectionReason` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `assetdisposal_assetId_idx`(`assetId` ASC),
    INDEX `assetdisposal_status_idx`(`status` ASC),
    PRIMARY KEY (`id` ASC)
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

    INDEX `assetinsurance_assetId_endDate_idx`(`assetId` ASC, `endDate` ASC),
    PRIMARY KEY (`id` ASC)
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
    `departmentSnapshot` VARCHAR(191) NULL,
    `approvalReason` VARCHAR(191) NULL,
    `approvedAt` DATETIME(3) NULL,
    `approvedById` INTEGER NULL,
    `rejectedAt` DATETIME(3) NULL,
    `rejectedById` INTEGER NULL,
    `rejectionReason` VARCHAR(191) NULL,
    `requestReason` VARCHAR(191) NULL,
    `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `requestedById` INTEGER NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'REQUESTED',

    INDEX `assetlocation_approvedById_fkey`(`approvedById` ASC),
    INDEX `assetlocation_assetId_isActive_idx`(`assetId` ASC, `isActive` ASC),
    INDEX `assetlocation_branchId_fkey`(`branchId` ASC),
    INDEX `assetlocation_employeeResponsibleId_fkey`(`employeeResponsibleId` ASC),
    INDEX `assetlocation_rejectedById_fkey`(`rejectedById` ASC),
    INDEX `assetlocation_requestedById_fkey`(`requestedById` ASC),
    PRIMARY KEY (`id` ASC)
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

    INDEX `assetscanlog_assetId_scannedAt_idx`(`assetId` ASC, `scannedAt` ASC),
    INDEX `assetscanlog_scannedById_fkey`(`scannedById` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

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

    INDEX `assetslamatrix_assetCategoryId_fkey`(`assetCategoryId` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `assetsupportmatrix` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `assetCategoryId` INTEGER NULL,
    `assetId` INTEGER NULL,
    `levelNo` INTEGER NOT NULL,
    `roleName` VARCHAR(191) NULL,
    `personName` VARCHAR(191) NULL,
    `employeeId` INTEGER NULL,
    `contactNumber` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `escalationTime` INTEGER NULL,
    `escalationUnit` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `assetsupportmatrix_assetCategoryId_assetId_levelNo_idx`(`assetCategoryId` ASC, `assetId` ASC, `levelNo` ASC),
    INDEX `assetsupportmatrix_assetId_fkey`(`assetId` ASC),
    INDEX `assetsupportmatrix_employeeId_fkey`(`employeeId` ASC),
    PRIMARY KEY (`id` ASC)
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
    `transferDate` DATETIME(3) NULL DEFAULT CURRENT_TIMESTAMP(3),
    `reason` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `approvalReason` TEXT NULL,
    `approvedAt` DATETIME(3) NULL,
    `approvedById` INTEGER NULL,
    `destinationAddress` VARCHAR(191) NULL,
    `destinationContactNumber` VARCHAR(191) NULL,
    `destinationContactPerson` VARCHAR(191) NULL,
    `destinationName` VARCHAR(191) NULL,
    `destinationType` VARCHAR(191) NULL,
    `parentTransferId` INTEGER NULL,
    `rejectedAt` DATETIME(3) NULL,
    `rejectionReason` TEXT NULL,
    `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `requestedById` INTEGER NULL,
    `returnReason` TEXT NULL,
    `returnedAt` DATETIME(3) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'REQUESTED',

    INDEX `assettransferhistory_approvedById_fkey`(`approvedById` ASC),
    INDEX `assettransferhistory_assetId_fkey`(`assetId` ASC),
    INDEX `assettransferhistory_fromBranchId_fkey`(`fromBranchId` ASC),
    INDEX `assettransferhistory_parentTransferId_fkey`(`parentTransferId` ASC),
    INDEX `assettransferhistory_requestedById_fkey`(`requestedById` ASC),
    INDEX `assettransferhistory_toBranchId_fkey`(`toBranchId` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `auditlog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `entityType` VARCHAR(191) NOT NULL,
    `entityId` INTEGER NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `oldValue` LONGTEXT NULL,
    `newValue` LONGTEXT NULL,
    `performedBy` VARCHAR(191) NULL,
    `performedById` INTEGER NULL,
    `ipAddress` VARCHAR(191) NULL,
    `userAgent` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `auditlog_action_createdAt_idx`(`action` ASC, `createdAt` ASC),
    INDEX `auditlog_entityType_entityId_idx`(`entityType` ASC, `entityId` ASC),
    INDEX `auditlog_performedById_createdAt_idx`(`performedById` ASC, `createdAt` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `branch` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `createdById` INTEGER NULL,
    `updatedById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `address` TEXT NULL,
    `city` VARCHAR(191) NULL,
    `code` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `phone` VARCHAR(191) NULL,
    `pincode` VARCHAR(191) NULL,
    `state` VARCHAR(191) NULL,

    UNIQUE INDEX `branch_code_key`(`code` ASC),
    UNIQUE INDEX `branch_name_key`(`name` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `calibrationchecklistitem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `templateId` INTEGER NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `expectedValue` VARCHAR(191) NULL,
    `unit` VARCHAR(191) NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isRequired` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `calibrationchecklistitem_templateId_sortOrder_idx`(`templateId` ASC, `sortOrder` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `calibrationchecklisttemplate` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `assetCategoryId` INTEGER NULL,
    `assetId` INTEGER NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `calibrationchecklisttemplate_assetCategoryId_idx`(`assetCategoryId` ASC),
    INDEX `calibrationchecklisttemplate_assetId_idx`(`assetId` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `calibrationhistory` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `assetId` INTEGER NOT NULL,
    `scheduleId` INTEGER NULL,
    `calibratedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `dueAt` DATETIME(3) NULL,
    `calibratedByType` VARCHAR(191) NULL,
    `calibratedByName` VARCHAR(191) NULL,
    `vendorId` INTEGER NULL,
    `result` ENUM('PASS', 'FAIL', 'NA') NOT NULL DEFAULT 'NA',
    `certificateNo` VARCHAR(191) NULL,
    `certificateUrl` VARCHAR(191) NULL,
    `remarks` TEXT NULL,
    `createdById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `calibrationhistory_assetId_calibratedAt_idx`(`assetId` ASC, `calibratedAt` ASC),
    INDEX `calibrationhistory_createdById_fkey`(`createdById` ASC),
    INDEX `calibrationhistory_scheduleId_fkey`(`scheduleId` ASC),
    INDEX `calibrationhistory_vendorId_fkey`(`vendorId` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `calibrationschedule` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `assetId` INTEGER NOT NULL,
    `frequencyValue` INTEGER NOT NULL,
    `frequencyUnit` VARCHAR(191) NOT NULL,
    `nextDueAt` DATETIME(3) NOT NULL,
    `lastCalibratedAt` DATETIME(3) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `standardProcedure` VARCHAR(191) NULL,
    `vendorId` INTEGER NULL,
    `reminderDays` INTEGER NULL DEFAULT 7,
    `notes` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `calibrationschedule_assetId_nextDueAt_idx`(`assetId` ASC, `nextDueAt` ASC),
    INDEX `calibrationschedule_vendorId_fkey`(`vendorId` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `consumable` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `unit` VARCHAR(191) NULL,
    `stockQuantity` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `reorderLevel` DECIMAL(12, 2) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdById` INTEGER NULL,
    `updatedById` INTEGER NULL,

    UNIQUE INDEX `consumable_name_key`(`name` ASC),
    PRIMARY KEY (`id` ASC)
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

    INDEX `consumablebatch_consumableId_expiryDate_idx`(`consumableId` ASC, `expiryDate` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `department` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `createdById` INTEGER NULL,
    `updatedById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `code` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `parentDepartmentId` INTEGER NULL,

    UNIQUE INDEX `department_code_key`(`code` ASC),
    UNIQUE INDEX `department_name_key`(`name` ASC),
    INDEX `department_parentDepartmentId_fkey`(`parentDepartmentId` ASC),
    PRIMARY KEY (`id` ASC)
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

    INDEX `depreciationlog_assetId_periodEnd_idx`(`assetId` ASC, `periodEnd` ASC),
    INDEX `depreciationlog_doneById_fkey`(`doneById` ASC),
    PRIMARY KEY (`id` ASC)
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

    INDEX `document_assetId_fkey`(`assetId` ASC),
    INDEX `document_entityType_entityId_idx`(`entityType` ASC, `entityId` ASC),
    INDEX `document_uploadedById_fkey`(`uploadedById` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `emailtemplate` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `subject` VARCHAR(191) NOT NULL,
    `bodyHtml` TEXT NOT NULL,
    `bodyText` TEXT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `emailtemplate_code_key`(`code` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employee` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `employeeID` VARCHAR(191) NOT NULL,
    `departmentId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `role` ENUM('HOD', 'SUPERVISOR', 'EXECUTIVE') NOT NULL DEFAULT 'EXECUTIVE',
    `designation` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `phone` VARCHAR(191) NULL,
    `reportingToId` INTEGER NULL,

    INDEX `employee_departmentId_fkey`(`departmentId` ASC),
    UNIQUE INDEX `employee_employeeID_key`(`employeeID` ASC),
    INDEX `employee_reportingToId_fkey`(`reportingToId` ASC),
    PRIMARY KEY (`id` ASC)
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

    INDEX `gatepass_assetId_createdAt_idx`(`assetId` ASC, `createdAt` ASC),
    UNIQUE INDEX `gatepass_gatePassNo_key`(`gatePassNo` ASC),
    PRIMARY KEY (`id` ASC)
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

    INDEX `insuranceclaim_assetId_fkey`(`assetId` ASC),
    UNIQUE INDEX `insuranceclaim_insuranceId_claimNumber_key`(`insuranceId` ASC, `claimNumber` ASC),
    PRIMARY KEY (`id` ASC)
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

    INDEX `inventorytransaction_consumableId_idx`(`consumableId` ASC),
    INDEX `inventorytransaction_performedById_fkey`(`performedById` ASC),
    INDEX `inventorytransaction_sparePartId_idx`(`sparePartId` ASC),
    PRIMARY KEY (`id` ASC)
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

    INDEX `loginhistory_userId_fkey`(`userId` ASC),
    PRIMARY KEY (`id` ASC)
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
    `ticketId` INTEGER NULL,
    `serviceContractId` INTEGER NULL,

    INDEX `maintenancehistory_assetId_actualDoneAt_idx`(`assetId` ASC, `actualDoneAt` ASC),
    INDEX `maintenancehistory_serviceContractId_fkey`(`serviceContractId` ASC),
    INDEX `maintenancehistory_ticketId_fkey`(`ticketId` ASC),
    PRIMARY KEY (`id` ASC)
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
    `reminderDays` INTEGER NULL DEFAULT 7,

    INDEX `maintenanceschedule_assetId_nextDueAt_idx`(`assetId` ASC, `nextDueAt` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `modulepermission` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `moduleId` INTEGER NULL,
    `moduleItemId` INTEGER NULL,
    `role` VARCHAR(191) NULL,
    `employeeId` INTEGER NULL,
    `canAccess` BOOLEAN NOT NULL DEFAULT true,
    `createdById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `modulepermission_employeeId_idx`(`employeeId` ASC),
    UNIQUE INDEX `modulepermission_moduleId_moduleItemId_role_employeeId_key`(`moduleId` ASC, `moduleItemId` ASC, `role` ASC, `employeeId` ASC),
    INDEX `modulepermission_moduleItemId_fkey`(`moduleItemId` ASC),
    INDEX `modulepermission_role_idx`(`role` ASC),
    PRIMARY KEY (`id` ASC)
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

    INDEX `notification_assetId_createdAt_idx`(`assetId` ASC, `createdAt` ASC),
    INDEX `notification_claimId_fkey`(`claimId` ASC),
    INDEX `notification_createdById_fkey`(`createdById` ASC),
    UNIQUE INDEX `notification_dedupeKey_key`(`dedupeKey` ASC),
    INDEX `notification_employeeId_fkey`(`employeeId` ASC),
    INDEX `notification_gatePassId_fkey`(`gatePassId` ASC),
    INDEX `notification_insuranceId_fkey`(`insuranceId` ASC),
    INDEX `notification_ticketId_createdAt_idx`(`ticketId` ASC, `createdAt` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notificationpreference` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `employeeId` INTEGER NOT NULL,
    `warrantyExpiry` BOOLEAN NOT NULL DEFAULT true,
    `insuranceExpiry` BOOLEAN NOT NULL DEFAULT true,
    `amcCmcExpiry` BOOLEAN NOT NULL DEFAULT true,
    `maintenanceDue` BOOLEAN NOT NULL DEFAULT true,
    `slaBreach` BOOLEAN NOT NULL DEFAULT true,
    `lowStock` BOOLEAN NOT NULL DEFAULT true,
    `gatepassOverdue` BOOLEAN NOT NULL DEFAULT true,
    `ticketUpdates` BOOLEAN NOT NULL DEFAULT true,
    `assetTransfer` BOOLEAN NOT NULL DEFAULT true,
    `channelInApp` BOOLEAN NOT NULL DEFAULT true,
    `channelEmail` BOOLEAN NOT NULL DEFAULT false,
    `channelSms` BOOLEAN NOT NULL DEFAULT false,
    `channelWhatsapp` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `notificationpreference_employeeId_key`(`employeeId` ASC),
    PRIMARY KEY (`id` ASC)
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

    INDEX `notificationrecipient_employeeId_isRead_createdAt_idx`(`employeeId` ASC, `isRead` ASC, `createdAt` ASC),
    UNIQUE INDEX `notificationrecipient_notificationId_employeeId_key`(`notificationId` ASC, `employeeId` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pmchecklistitem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `templateId` INTEGER NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `itemType` VARCHAR(191) NULL,
    `expectedValue` VARCHAR(191) NULL,
    `unit` VARCHAR(191) NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isRequired` BOOLEAN NOT NULL DEFAULT true,

    INDEX `pmchecklistitem_templateId_sortOrder_idx`(`templateId` ASC, `sortOrder` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pmchecklistresult` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `runId` INTEGER NOT NULL,
    `itemId` INTEGER NOT NULL,
    `checked` BOOLEAN NULL,
    `value` VARCHAR(191) NULL,
    `remarks` TEXT NULL,
    `photoProof` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `pmchecklistresult_itemId_fkey`(`itemId` ASC),
    UNIQUE INDEX `pmchecklistresult_runId_itemId_key`(`runId` ASC, `itemId` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pmchecklistrun` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `assetId` INTEGER NOT NULL,
    `templateId` INTEGER NOT NULL,
    `maintenanceHistoryId` INTEGER NULL,
    `scheduledDue` DATETIME(3) NOT NULL,
    `performedAt` DATETIME(3) NULL,
    `performedBy` VARCHAR(191) NULL,
    `resultStatus` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `pmchecklistrun_assetId_scheduledDue_idx`(`assetId` ASC, `scheduledDue` ASC),
    INDEX `pmchecklistrun_maintenanceHistoryId_fkey`(`maintenanceHistoryId` ASC),
    INDEX `pmchecklistrun_templateId_fkey`(`templateId` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pmchecklisttemplate` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `pmFormatCode` VARCHAR(191) NULL,
    `assetCategoryId` INTEGER NULL,
    `assetId` INTEGER NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `pmchecklisttemplate_assetCategoryId_idx`(`assetCategoryId` ASC),
    INDEX `pmchecklisttemplate_assetId_idx`(`assetId` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `preventivechecklistitem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `templateId` INTEGER NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isRequired` BOOLEAN NOT NULL DEFAULT true,

    INDEX `preventivechecklistitem_templateId_sortOrder_idx`(`templateId` ASC, `sortOrder` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `preventivechecklistresult` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `runId` INTEGER NOT NULL,
    `itemId` INTEGER NOT NULL,
    `result` ENUM('PASS', 'FAIL', 'NA') NOT NULL,
    `remarks` TEXT NULL,
    `photoProof` VARCHAR(191) NULL,
    `checkedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `preventivechecklistresult_itemId_fkey`(`itemId` ASC),
    INDEX `preventivechecklistresult_runId_idx`(`runId` ASC),
    UNIQUE INDEX `preventivechecklistresult_runId_itemId_key`(`runId` ASC, `itemId` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `preventivechecklistrun` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `assetId` INTEGER NOT NULL,
    `templateId` INTEGER NOT NULL,
    `maintenanceHistoryId` INTEGER NULL,
    `scheduledDue` DATETIME(3) NOT NULL,
    `performedAt` DATETIME(3) NULL,
    `performedById` INTEGER NULL,
    `status` ENUM('DUE', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED') NOT NULL DEFAULT 'DUE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `preventivechecklistrun_assetId_scheduledDue_idx`(`assetId` ASC, `scheduledDue` ASC),
    INDEX `preventivechecklistrun_maintenanceHistoryId_fkey`(`maintenanceHistoryId` ASC),
    INDEX `preventivechecklistrun_performedById_fkey`(`performedById` ASC),
    INDEX `preventivechecklistrun_templateId_scheduledDue_idx`(`templateId` ASC, `scheduledDue` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `preventivechecklisttemplate` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `assetCategoryId` INTEGER NULL,
    `assetId` INTEGER NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `slaOverdueDays` INTEGER NULL DEFAULT 3,

    INDEX `preventivechecklisttemplate_assetCategoryId_idx`(`assetCategoryId` ASC),
    INDEX `preventivechecklisttemplate_assetId_idx`(`assetId` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `qrscanlog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `assetId` INTEGER NOT NULL,
    `scannedById` INTEGER NULL,
    `location` VARCHAR(191) NULL,
    `action` VARCHAR(191) NULL,
    `scannedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `qrscanlog_assetId_scannedAt_idx`(`assetId` ASC, `scannedAt` ASC),
    INDEX `qrscanlog_scannedById_fkey`(`scannedById` ASC),
    PRIMARY KEY (`id` ASC)
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
    `vendorResolutionUnit` VARCHAR(191) NULL,
    `vendorResolutionValue` INTEGER NULL,
    `vendorResponseUnit` VARCHAR(191) NULL,
    `vendorResponseValue` INTEGER NULL,

    INDEX `servicecontract_assetId_endDate_idx`(`assetId` ASC, `endDate` ASC),
    INDEX `servicecontract_vendorId_fkey`(`vendorId` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `smtpconfig` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `host` VARCHAR(191) NOT NULL,
    `port` INTEGER NOT NULL,
    `secure` BOOLEAN NOT NULL DEFAULT true,
    `username` VARCHAR(191) NOT NULL,
    `password` VARCHAR(191) NOT NULL,
    `fromName` VARCHAR(191) NOT NULL DEFAULT 'Smart Assets',
    `fromEmail` VARCHAR(191) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id` ASC)
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

    INDEX `sparepart_vendorId_idx`(`vendorId` ASC),
    PRIMARY KEY (`id` ASC)
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

    INDEX `sparepartusage_assetId_usedAt_idx`(`assetId` ASC, `usedAt` ASC),
    INDEX `sparepartusage_sparePartId_fkey`(`sparePartId` ASC),
    INDEX `sparepartusage_ticketId_fkey`(`ticketId` ASC),
    INDEX `sparepartusage_usedById_fkey`(`usedById` ASC),
    PRIMARY KEY (`id` ASC)
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
    `status` ENUM('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'WORK_COMPLETED', 'RESOLVED', 'TERMINATED', 'CLOSED', 'REJECTED') NOT NULL DEFAULT 'OPEN',
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
    `assignedById` INTEGER NULL,
    `assignedToId` INTEGER NULL,
    `assignmentNote` TEXT NULL,
    `closeRemarks` TEXT NULL,
    `closedAt` DATETIME(3) NULL,
    `closedById` INTEGER NULL,
    `isTransferred` BOOLEAN NOT NULL DEFAULT false,
    `lastAssignedAt` DATETIME(3) NULL,
    `owningDepartmentId` INTEGER NULL,
    `reassignCount` INTEGER NOT NULL DEFAULT 0,
    `terminatedAt` DATETIME(3) NULL,
    `terminatedById` INTEGER NULL,
    `terminationNote` TEXT NULL,
    `transferCount` INTEGER NOT NULL DEFAULT 0,
    `currentSlaLevel` ENUM('L1', 'L2', 'L3') NULL,
    `slaCategory` ENUM('LOW', 'MEDIUM', 'HIGH') NULL,
    `customerSatisfaction` INTEGER NULL,
    `followUpDate` DATETIME(3) NULL,
    `resolutionSummary` TEXT NULL,
    `rootCause` TEXT NULL,
    `internalSlaUnit` VARCHAR(191) NULL,
    `internalSlaValue` INTEGER NULL,
    `slaSource` VARCHAR(191) NULL,
    `vendorSlaBreached` BOOLEAN NULL,
    `vendorSlaUnit` VARCHAR(191) NULL,
    `vendorSlaValue` INTEGER NULL,

    INDEX `ticket_assetId_createdAt_idx`(`assetId` ASC, `createdAt` ASC),
    INDEX `ticket_assignedById_fkey`(`assignedById` ASC),
    INDEX `ticket_assignedToId_fkey`(`assignedToId` ASC),
    INDEX `ticket_departmentId_status_idx`(`departmentId` ASC, `status` ASC),
    INDEX `ticket_owningDepartmentId_fkey`(`owningDepartmentId` ASC),
    INDEX `ticket_raisedById_fkey`(`raisedById` ASC),
    UNIQUE INDEX `ticket_ticketId_key`(`ticketId` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ticketassignmenthistory` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ticketId` INTEGER NOT NULL,
    `fromEmployeeId` INTEGER NULL,
    `toEmployeeId` INTEGER NULL,
    `action` ENUM('ASSIGNED', 'REASSIGNED', 'UNASSIGNED') NOT NULL,
    `comment` TEXT NOT NULL,
    `performedById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ticketassignmenthistory_fromEmployeeId_fkey`(`fromEmployeeId` ASC),
    INDEX `ticketassignmenthistory_performedById_fkey`(`performedById` ASC),
    INDEX `ticketassignmenthistory_ticketId_createdAt_idx`(`ticketId` ASC, `createdAt` ASC),
    INDEX `ticketassignmenthistory_toEmployeeId_fkey`(`toEmployeeId` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ticketstatushistory` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ticketId` INTEGER NOT NULL,
    `status` ENUM('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'WORK_COMPLETED', 'RESOLVED', 'TERMINATED', 'CLOSED', 'REJECTED') NOT NULL,
    `changedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `changedBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `changedById` INTEGER NULL,
    `note` TEXT NULL,

    INDEX `ticketstatushistory_changedById_fkey`(`changedById` ASC),
    INDEX `ticketstatushistory_ticketId_fkey`(`ticketId` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tickettransferhistory` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ticketId` INTEGER NOT NULL,
    `transferType` ENUM('INTERNAL_DEPARTMENT', 'EXTERNAL_VENDOR', 'EXTERNAL_SERVICE') NOT NULL,
    `status` ENUM('REQUESTED', 'APPROVED', 'REJECTED', 'COMPLETED') NOT NULL DEFAULT 'REQUESTED',
    `fromDepartmentId` INTEGER NULL,
    `toDepartmentId` INTEGER NULL,
    `vendorId` INTEGER NULL,
    `comment` TEXT NOT NULL,
    `requestedById` INTEGER NULL,
    `approvedById` INTEGER NULL,
    `rejectionReason` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `tickettransferhistory_approvedById_fkey`(`approvedById` ASC),
    INDEX `tickettransferhistory_fromDepartmentId_fkey`(`fromDepartmentId` ASC),
    INDEX `tickettransferhistory_requestedById_fkey`(`requestedById` ASC),
    INDEX `tickettransferhistory_ticketId_createdAt_idx`(`ticketId` ASC, `createdAt` ASC),
    INDEX `tickettransferhistory_toDepartmentId_fkey`(`toDepartmentId` ASC),
    INDEX `tickettransferhistory_vendorId_fkey`(`vendorId` ASC),
    PRIMARY KEY (`id` ASC)
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

    UNIQUE INDEX `users_employeeID_key`(`employeeID` ASC),
    UNIQUE INDEX `users_username_key`(`username` ASC),
    PRIMARY KEY (`id` ASC)
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
    `alternatePhone` VARCHAR(191) NULL,
    `contactPerson` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `address` TEXT NULL,
    `bankAccount` VARCHAR(191) NULL,
    `bankIfsc` VARCHAR(191) NULL,
    `bankName` VARCHAR(191) NULL,
    `city` VARCHAR(191) NULL,
    `gstNumber` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `panNumber` VARCHAR(191) NULL,
    `pincode` VARCHAR(191) NULL,
    `rating` INTEGER NULL,
    `state` VARCHAR(191) NULL,
    `vendorType` VARCHAR(191) NULL,

    UNIQUE INDEX `vendor_name_key`(`name` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `warranty` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `assetId` INTEGER NOT NULL,
    `warrantyStart` DATETIME(3) NOT NULL,
    `warrantyEnd` DATETIME(3) NOT NULL,
    `daysToExpiry` INTEGER NULL,
    `isUnderWarranty` BOOLEAN NOT NULL,
    `alertSent` BOOLEAN NOT NULL DEFAULT false,
    `createdById` INTEGER NULL,
    `updatedById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `coverageDetails` TEXT NULL,
    `exclusions` TEXT NULL,
    `remarks` TEXT NULL,
    `supportContact` VARCHAR(191) NULL,
    `supportEmail` VARCHAR(191) NULL,
    `termsUrl` VARCHAR(191) NULL,
    `vendorId` INTEGER NULL,
    `warrantyProvider` VARCHAR(191) NULL,
    `warrantyReference` VARCHAR(191) NULL,
    `warrantyType` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,

    INDEX `warranty_assetId_idx`(`assetId` ASC),
    INDEX `warranty_assetId_isActive_idx`(`assetId` ASC, `isActive` ASC),
    INDEX `warranty_vendorId_fkey`(`vendorId` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `AssetAssignment` ADD CONSTRAINT `AssetAssignment_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `asset`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssetAssignment` ADD CONSTRAINT `AssetAssignment_assignedById_fkey` FOREIGN KEY (`assignedById`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssetAssignment` ADD CONSTRAINT `AssetAssignment_assignedToId_fkey` FOREIGN KEY (`assignedToId`) REFERENCES `employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssetAssignment` ADD CONSTRAINT `AssetAssignment_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssetAssignmentHistory` ADD CONSTRAINT `AssetAssignmentHistory_assignmentId_fkey` FOREIGN KEY (`assignmentId`) REFERENCES `AssetAssignment`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssetAssignmentHistory` ADD CONSTRAINT `AssetAssignmentHistory_performedById_fkey` FOREIGN KEY (`performedById`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssetSpecification` ADD CONSTRAINT `AssetSpecification_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `asset`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EscalationMatrix` ADD CONSTRAINT `EscalationMatrix_assetCategoryId_fkey` FOREIGN KEY (`assetCategoryId`) REFERENCES `assetcategory`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EscalationMatrix` ADD CONSTRAINT `EscalationMatrix_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `department`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EscalationMatrix` ADD CONSTRAINT `EscalationMatrix_notifyEmployeeId_fkey` FOREIGN KEY (`notifyEmployeeId`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TicketEscalation` ADD CONSTRAINT `TicketEscalation_notifiedEmployeeId_fkey` FOREIGN KEY (`notifiedEmployeeId`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TicketEscalation` ADD CONSTRAINT `TicketEscalation_ticketId_fkey` FOREIGN KEY (`ticketId`) REFERENCES `ticket`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `appmoduleitem` ADD CONSTRAINT `appmoduleitem_moduleId_fkey` FOREIGN KEY (`moduleId`) REFERENCES `appmodule`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asset` ADD CONSTRAINT `asset_allottedToId_fkey` FOREIGN KEY (`allottedToId`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asset` ADD CONSTRAINT `asset_assetCategoryId_fkey` FOREIGN KEY (`assetCategoryId`) REFERENCES `assetcategory`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asset` ADD CONSTRAINT `asset_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `department`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asset` ADD CONSTRAINT `asset_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asset` ADD CONSTRAINT `asset_parentAssetId_fkey` FOREIGN KEY (`parentAssetId`) REFERENCES `asset`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asset` ADD CONSTRAINT `asset_supervisorId_fkey` FOREIGN KEY (`supervisorId`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asset` ADD CONSTRAINT `asset_targetDepartmentId_fkey` FOREIGN KEY (`targetDepartmentId`) REFERENCES `department`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asset` ADD CONSTRAINT `asset_vendorId_fkey` FOREIGN KEY (`vendorId`) REFERENCES `vendor`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assetacknowledgementitem` ADD CONSTRAINT `assetacknowledgementitem_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `assetacknowledgementtemplate`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assetacknowledgementresult` ADD CONSTRAINT `assetacknowledgementresult_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `assetacknowledgementitem`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assetacknowledgementresult` ADD CONSTRAINT `assetacknowledgementresult_runId_fkey` FOREIGN KEY (`runId`) REFERENCES `assetacknowledgementrun`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assetacknowledgementrun` ADD CONSTRAINT `assetacknowledgementrun_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `asset`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assetacknowledgementrun` ADD CONSTRAINT `assetacknowledgementrun_assignedToId_fkey` FOREIGN KEY (`assignedToId`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assetacknowledgementrun` ADD CONSTRAINT `assetacknowledgementrun_assignmentId_fkey` FOREIGN KEY (`assignmentId`) REFERENCES `AssetAssignment`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assetacknowledgementrun` ADD CONSTRAINT `assetacknowledgementrun_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `assetacknowledgementtemplate`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assetacknowledgementrun` ADD CONSTRAINT `assetacknowledgementrun_transferHistoryId_fkey` FOREIGN KEY (`transferHistoryId`) REFERENCES `assettransferhistory`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assetacknowledgementtemplate` ADD CONSTRAINT `assetacknowledgementtemplate_assetCategoryId_fkey` FOREIGN KEY (`assetCategoryId`) REFERENCES `assetcategory`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assetacknowledgementtemplate` ADD CONSTRAINT `assetacknowledgementtemplate_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `asset`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assetaudititem` ADD CONSTRAINT `assetaudititem_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `asset`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assetaudititem` ADD CONSTRAINT `assetaudititem_auditId_fkey` FOREIGN KEY (`auditId`) REFERENCES `assetaudit`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assetdepreciation` ADD CONSTRAINT `assetdepreciation_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `asset`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assetdisposal` ADD CONSTRAINT `assetdisposal_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `asset`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assetinsurance` ADD CONSTRAINT `assetinsurance_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `asset`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assetlocation` ADD CONSTRAINT `assetlocation_approvedById_fkey` FOREIGN KEY (`approvedById`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assetlocation` ADD CONSTRAINT `assetlocation_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `asset`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assetlocation` ADD CONSTRAINT `assetlocation_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assetlocation` ADD CONSTRAINT `assetlocation_employeeResponsibleId_fkey` FOREIGN KEY (`employeeResponsibleId`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assetlocation` ADD CONSTRAINT `assetlocation_rejectedById_fkey` FOREIGN KEY (`rejectedById`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assetlocation` ADD CONSTRAINT `assetlocation_requestedById_fkey` FOREIGN KEY (`requestedById`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assetscanlog` ADD CONSTRAINT `assetscanlog_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `asset`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assetscanlog` ADD CONSTRAINT `assetscanlog_scannedById_fkey` FOREIGN KEY (`scannedById`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assetslamatrix` ADD CONSTRAINT `assetslamatrix_assetCategoryId_fkey` FOREIGN KEY (`assetCategoryId`) REFERENCES `assetcategory`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assetsupportmatrix` ADD CONSTRAINT `assetsupportmatrix_assetCategoryId_fkey` FOREIGN KEY (`assetCategoryId`) REFERENCES `assetcategory`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assetsupportmatrix` ADD CONSTRAINT `assetsupportmatrix_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `asset`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assetsupportmatrix` ADD CONSTRAINT `assetsupportmatrix_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assettransferhistory` ADD CONSTRAINT `assettransferhistory_approvedById_fkey` FOREIGN KEY (`approvedById`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assettransferhistory` ADD CONSTRAINT `assettransferhistory_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `asset`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assettransferhistory` ADD CONSTRAINT `assettransferhistory_fromBranchId_fkey` FOREIGN KEY (`fromBranchId`) REFERENCES `branch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assettransferhistory` ADD CONSTRAINT `assettransferhistory_parentTransferId_fkey` FOREIGN KEY (`parentTransferId`) REFERENCES `assettransferhistory`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assettransferhistory` ADD CONSTRAINT `assettransferhistory_requestedById_fkey` FOREIGN KEY (`requestedById`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assettransferhistory` ADD CONSTRAINT `assettransferhistory_toBranchId_fkey` FOREIGN KEY (`toBranchId`) REFERENCES `branch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `calibrationchecklistitem` ADD CONSTRAINT `calibrationchecklistitem_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `calibrationchecklisttemplate`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `calibrationchecklisttemplate` ADD CONSTRAINT `calibrationchecklisttemplate_assetCategoryId_fkey` FOREIGN KEY (`assetCategoryId`) REFERENCES `assetcategory`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `calibrationchecklisttemplate` ADD CONSTRAINT `calibrationchecklisttemplate_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `asset`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `calibrationhistory` ADD CONSTRAINT `calibrationhistory_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `asset`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `calibrationhistory` ADD CONSTRAINT `calibrationhistory_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `calibrationhistory` ADD CONSTRAINT `calibrationhistory_scheduleId_fkey` FOREIGN KEY (`scheduleId`) REFERENCES `calibrationschedule`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `calibrationhistory` ADD CONSTRAINT `calibrationhistory_vendorId_fkey` FOREIGN KEY (`vendorId`) REFERENCES `vendor`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `calibrationschedule` ADD CONSTRAINT `calibrationschedule_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `asset`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `calibrationschedule` ADD CONSTRAINT `calibrationschedule_vendorId_fkey` FOREIGN KEY (`vendorId`) REFERENCES `vendor`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `consumablebatch` ADD CONSTRAINT `consumablebatch_consumableId_fkey` FOREIGN KEY (`consumableId`) REFERENCES `consumable`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `department` ADD CONSTRAINT `department_parentDepartmentId_fkey` FOREIGN KEY (`parentDepartmentId`) REFERENCES `department`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `depreciationlog` ADD CONSTRAINT `depreciationlog_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `asset`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `depreciationlog` ADD CONSTRAINT `depreciationlog_doneById_fkey` FOREIGN KEY (`doneById`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `document` ADD CONSTRAINT `document_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `asset`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `document` ADD CONSTRAINT `document_uploadedById_fkey` FOREIGN KEY (`uploadedById`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employee` ADD CONSTRAINT `employee_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `department`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employee` ADD CONSTRAINT `employee_reportingToId_fkey` FOREIGN KEY (`reportingToId`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `gatepass` ADD CONSTRAINT `gatepass_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `asset`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `insuranceclaim` ADD CONSTRAINT `insuranceclaim_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `asset`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `insuranceclaim` ADD CONSTRAINT `insuranceclaim_insuranceId_fkey` FOREIGN KEY (`insuranceId`) REFERENCES `assetinsurance`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventorytransaction` ADD CONSTRAINT `inventorytransaction_consumableId_fkey` FOREIGN KEY (`consumableId`) REFERENCES `consumable`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventorytransaction` ADD CONSTRAINT `inventorytransaction_performedById_fkey` FOREIGN KEY (`performedById`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventorytransaction` ADD CONSTRAINT `inventorytransaction_sparePartId_fkey` FOREIGN KEY (`sparePartId`) REFERENCES `sparepart`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `loginhistory` ADD CONSTRAINT `loginhistory_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `maintenancehistory` ADD CONSTRAINT `maintenancehistory_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `asset`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `maintenancehistory` ADD CONSTRAINT `maintenancehistory_serviceContractId_fkey` FOREIGN KEY (`serviceContractId`) REFERENCES `servicecontract`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `maintenancehistory` ADD CONSTRAINT `maintenancehistory_ticketId_fkey` FOREIGN KEY (`ticketId`) REFERENCES `ticket`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `maintenanceschedule` ADD CONSTRAINT `maintenanceschedule_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `asset`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `modulepermission` ADD CONSTRAINT `modulepermission_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `modulepermission` ADD CONSTRAINT `modulepermission_moduleId_fkey` FOREIGN KEY (`moduleId`) REFERENCES `appmodule`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `modulepermission` ADD CONSTRAINT `modulepermission_moduleItemId_fkey` FOREIGN KEY (`moduleItemId`) REFERENCES `appmoduleitem`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification` ADD CONSTRAINT `notification_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `asset`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification` ADD CONSTRAINT `notification_claimId_fkey` FOREIGN KEY (`claimId`) REFERENCES `insuranceclaim`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification` ADD CONSTRAINT `notification_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification` ADD CONSTRAINT `notification_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification` ADD CONSTRAINT `notification_gatePassId_fkey` FOREIGN KEY (`gatePassId`) REFERENCES `gatepass`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification` ADD CONSTRAINT `notification_insuranceId_fkey` FOREIGN KEY (`insuranceId`) REFERENCES `assetinsurance`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification` ADD CONSTRAINT `notification_ticketId_fkey` FOREIGN KEY (`ticketId`) REFERENCES `ticket`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notificationpreference` ADD CONSTRAINT `notificationpreference_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notificationrecipient` ADD CONSTRAINT `notificationrecipient_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notificationrecipient` ADD CONSTRAINT `notificationrecipient_notificationId_fkey` FOREIGN KEY (`notificationId`) REFERENCES `notification`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pmchecklistitem` ADD CONSTRAINT `pmchecklistitem_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `pmchecklisttemplate`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pmchecklistresult` ADD CONSTRAINT `pmchecklistresult_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `pmchecklistitem`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pmchecklistresult` ADD CONSTRAINT `pmchecklistresult_runId_fkey` FOREIGN KEY (`runId`) REFERENCES `pmchecklistrun`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pmchecklistrun` ADD CONSTRAINT `pmchecklistrun_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `asset`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pmchecklistrun` ADD CONSTRAINT `pmchecklistrun_maintenanceHistoryId_fkey` FOREIGN KEY (`maintenanceHistoryId`) REFERENCES `maintenancehistory`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pmchecklistrun` ADD CONSTRAINT `pmchecklistrun_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `pmchecklisttemplate`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pmchecklisttemplate` ADD CONSTRAINT `pmchecklisttemplate_assetCategoryId_fkey` FOREIGN KEY (`assetCategoryId`) REFERENCES `assetcategory`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pmchecklisttemplate` ADD CONSTRAINT `pmchecklisttemplate_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `asset`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `preventivechecklistitem` ADD CONSTRAINT `preventivechecklistitem_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `preventivechecklisttemplate`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `preventivechecklistresult` ADD CONSTRAINT `preventivechecklistresult_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `preventivechecklistitem`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `preventivechecklistresult` ADD CONSTRAINT `preventivechecklistresult_runId_fkey` FOREIGN KEY (`runId`) REFERENCES `preventivechecklistrun`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `preventivechecklistrun` ADD CONSTRAINT `preventivechecklistrun_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `asset`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `preventivechecklistrun` ADD CONSTRAINT `preventivechecklistrun_maintenanceHistoryId_fkey` FOREIGN KEY (`maintenanceHistoryId`) REFERENCES `maintenancehistory`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `preventivechecklistrun` ADD CONSTRAINT `preventivechecklistrun_performedById_fkey` FOREIGN KEY (`performedById`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `preventivechecklistrun` ADD CONSTRAINT `preventivechecklistrun_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `preventivechecklisttemplate`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `preventivechecklisttemplate` ADD CONSTRAINT `preventivechecklisttemplate_assetCategoryId_fkey` FOREIGN KEY (`assetCategoryId`) REFERENCES `assetcategory`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `preventivechecklisttemplate` ADD CONSTRAINT `preventivechecklisttemplate_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `asset`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `qrscanlog` ADD CONSTRAINT `qrscanlog_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `asset`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `qrscanlog` ADD CONSTRAINT `qrscanlog_scannedById_fkey` FOREIGN KEY (`scannedById`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `servicecontract` ADD CONSTRAINT `servicecontract_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `asset`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `servicecontract` ADD CONSTRAINT `servicecontract_vendorId_fkey` FOREIGN KEY (`vendorId`) REFERENCES `vendor`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sparepart` ADD CONSTRAINT `sparepart_vendorId_fkey` FOREIGN KEY (`vendorId`) REFERENCES `vendor`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sparepartusage` ADD CONSTRAINT `sparepartusage_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `asset`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sparepartusage` ADD CONSTRAINT `sparepartusage_sparePartId_fkey` FOREIGN KEY (`sparePartId`) REFERENCES `sparepart`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sparepartusage` ADD CONSTRAINT `sparepartusage_ticketId_fkey` FOREIGN KEY (`ticketId`) REFERENCES `ticket`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sparepartusage` ADD CONSTRAINT `sparepartusage_usedById_fkey` FOREIGN KEY (`usedById`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ticket` ADD CONSTRAINT `ticket_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `asset`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ticket` ADD CONSTRAINT `ticket_assignedById_fkey` FOREIGN KEY (`assignedById`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ticket` ADD CONSTRAINT `ticket_assignedToId_fkey` FOREIGN KEY (`assignedToId`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ticket` ADD CONSTRAINT `ticket_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `department`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ticket` ADD CONSTRAINT `ticket_owningDepartmentId_fkey` FOREIGN KEY (`owningDepartmentId`) REFERENCES `department`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ticket` ADD CONSTRAINT `ticket_raisedById_fkey` FOREIGN KEY (`raisedById`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ticketassignmenthistory` ADD CONSTRAINT `ticketassignmenthistory_fromEmployeeId_fkey` FOREIGN KEY (`fromEmployeeId`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ticketassignmenthistory` ADD CONSTRAINT `ticketassignmenthistory_performedById_fkey` FOREIGN KEY (`performedById`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ticketassignmenthistory` ADD CONSTRAINT `ticketassignmenthistory_ticketId_fkey` FOREIGN KEY (`ticketId`) REFERENCES `ticket`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ticketassignmenthistory` ADD CONSTRAINT `ticketassignmenthistory_toEmployeeId_fkey` FOREIGN KEY (`toEmployeeId`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ticketstatushistory` ADD CONSTRAINT `ticketstatushistory_changedById_fkey` FOREIGN KEY (`changedById`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ticketstatushistory` ADD CONSTRAINT `ticketstatushistory_ticketId_fkey` FOREIGN KEY (`ticketId`) REFERENCES `ticket`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tickettransferhistory` ADD CONSTRAINT `tickettransferhistory_approvedById_fkey` FOREIGN KEY (`approvedById`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tickettransferhistory` ADD CONSTRAINT `tickettransferhistory_fromDepartmentId_fkey` FOREIGN KEY (`fromDepartmentId`) REFERENCES `department`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tickettransferhistory` ADD CONSTRAINT `tickettransferhistory_requestedById_fkey` FOREIGN KEY (`requestedById`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tickettransferhistory` ADD CONSTRAINT `tickettransferhistory_ticketId_fkey` FOREIGN KEY (`ticketId`) REFERENCES `ticket`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tickettransferhistory` ADD CONSTRAINT `tickettransferhistory_toDepartmentId_fkey` FOREIGN KEY (`toDepartmentId`) REFERENCES `department`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tickettransferhistory` ADD CONSTRAINT `tickettransferhistory_vendorId_fkey` FOREIGN KEY (`vendorId`) REFERENCES `vendor`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_employeeID_fkey` FOREIGN KEY (`employeeID`) REFERENCES `employee`(`employeeID`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `warranty` ADD CONSTRAINT `warranty_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `asset`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `warranty` ADD CONSTRAINT `warranty_vendorId_fkey` FOREIGN KEY (`vendorId`) REFERENCES `vendor`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

