import prisma from "../prismaClient";

/**
 * PROCUREMENT FEATURE FLAGS — one place to read the switches that turn the
 * newer procurement controls on.
 *
 * Every flag here defaults OFF. A control that appears without warning changes
 * how an existing client's flow behaves, and the failure is silent: an indent
 * that used to go through simply stops. Tenants opt in.
 *
 * The two exceptions are ENABLE_STORE_MODULE and ENABLE_WORKORDER_MODULE,
 * which default ON because they gate modules clients already use — switching
 * them off is the deliberate act.
 */

async function flag(key: string, defaultOn = false): Promise<boolean> {
  const row = await prisma.tenantConfig.findUnique({ where: { key } });
  if (!row?.value) return defaultOn;
  return row.value === "true";
}

async function number(key: string, fallback: number): Promise<number> {
  const row = await prisma.tenantConfig.findUnique({ where: { key } });
  const n = Number(row?.value);
  return isNaN(n) || n <= 0 ? fallback : n;
}

/** Rejected goods can be sent back and the settlement tracked. */
export const goodsReturnEnabled = () => flag("ENABLE_GOODS_RETURN");

/** A single order line can be cancelled without amending the whole order. */
export const partialCancellationEnabled = () => flag("ALLOW_PARTIAL_PO_CANCELLATION");

/** Store stock is held against an indent rather than left first-come. */
export const stockReservationEnabled = () => flag("ENABLE_STOCK_RESERVATION");

/** How long a reservation survives unclaimed. */
export const reservationHours = () => number("STOCK_RESERVATION_HOURS", 72);

/** Negotiated rates are pulled into indent and PO lines. */
export const rateContractsEnabled = () => flag("ENABLE_RATE_CONTRACTS");

/** Only vendors approved for the category may be quoted or ordered from. */
export const approvedVendorsOnly = () => flag("RESTRICT_TO_APPROVED_VENDORS");

/** Specifications are captured as attributes, not prose. */
export const structuredSpecsEnabled = () => flag("ENABLE_STRUCTURED_SPECS");

/** Every asset line needs a serial before the receipt can be accepted. */
export const serialMandatoryOnReceipt = () => flag("SERIAL_NUMBER_MANDATORY_ON_RECEIPT");

/** An asset may be created without a goods receipt behind it. Defaults ON. */
export const manualAssetAllowed = () => flag("MANUAL_ASSET_WITHOUT_PROCUREMENT", true);

/** Stores, stock and transfers. Defaults ON. */
export const storeModuleEnabled = () => flag("ENABLE_STORE_MODULE", true);

/** Work orders and maintenance. Defaults ON. */
export const workorderModuleEnabled = () => flag("ENABLE_WORKORDER_MODULE", true);

/**
 * The reservation expiry stamp for a reservation made now. Null when the
 * feature is off, so callers can store it unconditionally.
 */
export async function reservationExpiry(): Promise<Date | null> {
  if (!(await stockReservationEnabled())) return null;
  const hours = await reservationHours();
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}
