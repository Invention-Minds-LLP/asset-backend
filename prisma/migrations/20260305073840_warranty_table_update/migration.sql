/*
  Warnings:

  - You are about to drop the column `amcActive` on the `warranty` table. All the data in the column will be lost.
  - You are about to drop the column `amcEnd` on the `warranty` table. All the data in the column will be lost.
  - You are about to drop the column `amcStart` on the `warranty` table. All the data in the column will be lost.
  - You are about to drop the column `amcVendor` on the `warranty` table. All the data in the column will be lost.
  - You are about to drop the column `amcVisitsDue` on the `warranty` table. All the data in the column will be lost.
  - You are about to drop the column `lastServiceDate` on the `warranty` table. All the data in the column will be lost.
  - You are about to drop the column `nextVisitDue` on the `warranty` table. All the data in the column will be lost.
  - You are about to drop the column `serviceReport` on the `warranty` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE `maintenancehistory` ADD COLUMN `serviceContractId` INTEGER NULL;

-- AlterTable
ALTER TABLE `warranty` DROP COLUMN `amcActive`,
    DROP COLUMN `amcEnd`,
    DROP COLUMN `amcStart`,
    DROP COLUMN `amcVendor`,
    DROP COLUMN `amcVisitsDue`,
    DROP COLUMN `lastServiceDate`,
    DROP COLUMN `nextVisitDue`,
    DROP COLUMN `serviceReport`;

-- AddForeignKey
ALTER TABLE `maintenancehistory` ADD CONSTRAINT `maintenancehistory_serviceContractId_fkey` FOREIGN KEY (`serviceContractId`) REFERENCES `servicecontract`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
