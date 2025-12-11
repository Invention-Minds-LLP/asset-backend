/*
  Warnings:

  - Added the required column `changedBy` to the `TicketStatusHistory` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `ticketstatushistory` ADD COLUMN `changedBy` VARCHAR(191) NOT NULL;
