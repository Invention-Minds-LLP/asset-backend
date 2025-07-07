/*
  Warnings:

  - You are about to drop the column `employeeId` on the `user` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[employeeID]` on the table `Employee` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[employeeID]` on the table `User` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `employeeID` to the `Employee` table without a default value. This is not possible if the table is not empty.
  - Added the required column `employeeID` to the `User` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE `user` DROP FOREIGN KEY `User_employeeId_fkey`;

-- DropIndex
DROP INDEX `User_employeeId_key` ON `user`;

-- AlterTable
ALTER TABLE `employee` ADD COLUMN `employeeID` VARCHAR(191) NOT NULL;

-- AlterTable
ALTER TABLE `user` DROP COLUMN `employeeId`,
    ADD COLUMN `employeeID` VARCHAR(191) NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX `Employee_employeeID_key` ON `Employee`(`employeeID`);

-- CreateIndex
CREATE UNIQUE INDEX `User_employeeID_key` ON `User`(`employeeID`);

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_employeeID_fkey` FOREIGN KEY (`employeeID`) REFERENCES `Employee`(`employeeID`) ON DELETE RESTRICT ON UPDATE CASCADE;
