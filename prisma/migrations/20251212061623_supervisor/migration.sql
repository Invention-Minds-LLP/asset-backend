-- AlterTable
ALTER TABLE `asset` ADD COLUMN `employeeId` INTEGER NULL,
    ADD COLUMN `supervisorId` INTEGER NULL;

-- AddForeignKey
ALTER TABLE `Asset` ADD CONSTRAINT `Asset_supervisorId_fkey` FOREIGN KEY (`supervisorId`) REFERENCES `Employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Asset` ADD CONSTRAINT `Asset_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
