ALTER TABLE `warranty`
ADD CONSTRAINT `warranty_assetId_fkey`
FOREIGN KEY (`assetId`) REFERENCES `asset`(`id`)
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `warranty`
MODIFY `isActive` TINYINT(1) NOT NULL DEFAULT 1;

CREATE INDEX `warranty_assetId_idx` ON `warranty`(`assetId`);

CREATE INDEX `warranty_assetId_isActive_idx` ON `warranty`(`assetId`, `isActive`);