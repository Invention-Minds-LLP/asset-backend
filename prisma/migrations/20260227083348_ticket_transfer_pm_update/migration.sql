/*
  Warnings:

  - You are about to alter the column `status` on the `ticket` table. The data in that column could be lost. The data in that column will be cast from `VarChar(191)` to `Enum(EnumId(3))`.
  - You are about to alter the column `status` on the `ticketstatushistory` table. The data in that column could be lost. The data in that column will be cast from `VarChar(191)` to `Enum(EnumId(3))`.

*/
-- AlterTable
ALTER TABLE `maintenancehistory` ADD COLUMN `ticketId` INTEGER NULL;

-- AlterTable
ALTER TABLE `maintenanceschedule` ADD COLUMN `reminderDays` INTEGER NULL DEFAULT 7;

-- AlterTable
ALTER TABLE `ticket` ADD COLUMN `assignedById` INTEGER NULL,
    ADD COLUMN `assignedToId` INTEGER NULL,
    ADD COLUMN `assignmentNote` TEXT NULL,
    ADD COLUMN `closeRemarks` TEXT NULL,
    ADD COLUMN `closedAt` DATETIME(3) NULL,
    ADD COLUMN `closedById` INTEGER NULL,
    ADD COLUMN `isTransferred` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `lastAssignedAt` DATETIME(3) NULL,
    ADD COLUMN `owningDepartmentId` INTEGER NULL,
    ADD COLUMN `reassignCount` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `terminatedAt` DATETIME(3) NULL,
    ADD COLUMN `terminatedById` INTEGER NULL,
    ADD COLUMN `terminationNote` TEXT NULL,
    ADD COLUMN `transferCount` INTEGER NOT NULL DEFAULT 0,
    MODIFY `status` ENUM('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'RESOLVED', 'TERMINATED', 'CLOSED', 'REJECTED') NOT NULL DEFAULT 'OPEN';

-- AlterTable
ALTER TABLE `ticketstatushistory` ADD COLUMN `changedById` INTEGER NULL,
    ADD COLUMN `note` TEXT NULL,
    MODIFY `status` ENUM('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'RESOLVED', 'TERMINATED', 'CLOSED', 'REJECTED') NOT NULL;

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

    INDEX `ticketassignmenthistory_ticketId_createdAt_idx`(`ticketId`, `createdAt`),
    PRIMARY KEY (`id`)
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

    INDEX `preventivechecklisttemplate_assetCategoryId_idx`(`assetCategoryId`),
    INDEX `preventivechecklisttemplate_assetId_idx`(`assetId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `preventivechecklistitem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `templateId` INTEGER NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isRequired` BOOLEAN NOT NULL DEFAULT true,

    INDEX `preventivechecklistitem_templateId_sortOrder_idx`(`templateId`, `sortOrder`),
    PRIMARY KEY (`id`)
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

    INDEX `preventivechecklistrun_assetId_scheduledDue_idx`(`assetId`, `scheduledDue`),
    INDEX `preventivechecklistrun_templateId_scheduledDue_idx`(`templateId`, `scheduledDue`),
    PRIMARY KEY (`id`)
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

    INDEX `preventivechecklistresult_runId_idx`(`runId`),
    UNIQUE INDEX `preventivechecklistresult_runId_itemId_key`(`runId`, `itemId`),
    PRIMARY KEY (`id`)
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

    INDEX `tickettransferhistory_ticketId_createdAt_idx`(`ticketId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ticket` ADD CONSTRAINT `ticket_assignedToId_fkey` FOREIGN KEY (`assignedToId`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ticket` ADD CONSTRAINT `ticket_assignedById_fkey` FOREIGN KEY (`assignedById`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ticket` ADD CONSTRAINT `ticket_owningDepartmentId_fkey` FOREIGN KEY (`owningDepartmentId`) REFERENCES `department`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ticketassignmenthistory` ADD CONSTRAINT `ticketassignmenthistory_ticketId_fkey` FOREIGN KEY (`ticketId`) REFERENCES `ticket`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ticketassignmenthistory` ADD CONSTRAINT `ticketassignmenthistory_fromEmployeeId_fkey` FOREIGN KEY (`fromEmployeeId`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ticketassignmenthistory` ADD CONSTRAINT `ticketassignmenthistory_toEmployeeId_fkey` FOREIGN KEY (`toEmployeeId`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ticketassignmenthistory` ADD CONSTRAINT `ticketassignmenthistory_performedById_fkey` FOREIGN KEY (`performedById`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `maintenancehistory` ADD CONSTRAINT `maintenancehistory_ticketId_fkey` FOREIGN KEY (`ticketId`) REFERENCES `ticket`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ticketstatushistory` ADD CONSTRAINT `ticketstatushistory_changedById_fkey` FOREIGN KEY (`changedById`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `preventivechecklisttemplate` ADD CONSTRAINT `preventivechecklisttemplate_assetCategoryId_fkey` FOREIGN KEY (`assetCategoryId`) REFERENCES `assetcategory`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `preventivechecklisttemplate` ADD CONSTRAINT `preventivechecklisttemplate_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `asset`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `preventivechecklistitem` ADD CONSTRAINT `preventivechecklistitem_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `preventivechecklisttemplate`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `preventivechecklistrun` ADD CONSTRAINT `preventivechecklistrun_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `asset`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `preventivechecklistrun` ADD CONSTRAINT `preventivechecklistrun_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `preventivechecklisttemplate`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `preventivechecklistrun` ADD CONSTRAINT `preventivechecklistrun_maintenanceHistoryId_fkey` FOREIGN KEY (`maintenanceHistoryId`) REFERENCES `maintenancehistory`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `preventivechecklistrun` ADD CONSTRAINT `preventivechecklistrun_performedById_fkey` FOREIGN KEY (`performedById`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `preventivechecklistresult` ADD CONSTRAINT `preventivechecklistresult_runId_fkey` FOREIGN KEY (`runId`) REFERENCES `preventivechecklistrun`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `preventivechecklistresult` ADD CONSTRAINT `preventivechecklistresult_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `preventivechecklistitem`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tickettransferhistory` ADD CONSTRAINT `tickettransferhistory_ticketId_fkey` FOREIGN KEY (`ticketId`) REFERENCES `ticket`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tickettransferhistory` ADD CONSTRAINT `tickettransferhistory_fromDepartmentId_fkey` FOREIGN KEY (`fromDepartmentId`) REFERENCES `department`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tickettransferhistory` ADD CONSTRAINT `tickettransferhistory_toDepartmentId_fkey` FOREIGN KEY (`toDepartmentId`) REFERENCES `department`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tickettransferhistory` ADD CONSTRAINT `tickettransferhistory_vendorId_fkey` FOREIGN KEY (`vendorId`) REFERENCES `vendor`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tickettransferhistory` ADD CONSTRAINT `tickettransferhistory_requestedById_fkey` FOREIGN KEY (`requestedById`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tickettransferhistory` ADD CONSTRAINT `tickettransferhistory_approvedById_fkey` FOREIGN KEY (`approvedById`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
