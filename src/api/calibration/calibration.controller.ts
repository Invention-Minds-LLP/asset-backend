import { Request, Response } from "express";
import prisma from "../../prismaClient";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";
import { notify, getDepartmentHODs, getAdminIds } from "../../utilis/notificationHelper";

// ─── Calibration Schedules ─────────────────────────────────────────────────────

export const createCalibrationSchedule = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      assetId,
      frequencyValue,
      frequencyUnit,
      nextDueAt,
      standardProcedure,
      vendorId,
      reminderDays,
      notes,
    } = req.body;

    if (!assetId || !frequencyValue || !frequencyUnit || !nextDueAt) {
      res.status(400).json({ message: "assetId, frequencyValue, frequencyUnit, nextDueAt are required" });
      return;
    }

    const schedule = await prisma.calibrationSchedule.create({
      data: {
        assetId: Number(assetId),
        frequencyValue: Number(frequencyValue),
        frequencyUnit,
        nextDueAt: new Date(nextDueAt),
        standardProcedure,
        vendorId: vendorId ? Number(vendorId) : undefined,
        reminderDays: reminderDays ? Number(reminderDays) : 7,
        notes,
      },
      include: {
        asset: { select: { assetId: true, assetName: true, departmentId: true } },
        vendor: { select: { name: true } },
      },
    });

    // Fire-and-forget: notify department HODs about new calibration schedule
    getDepartmentHODs((schedule as any).asset?.departmentId).then(hodIds =>
      notify({
        type: "CALIBRATION",
        title: "Calibration Schedule Created",
        message: `Calibration schedule created for asset ${(schedule as any).asset?.assetName}, next due ${new Date(nextDueAt).toLocaleDateString()}`,
        recipientIds: hodIds,
        createdById: (req as any).user?.employeeDbId,
      })
    ).catch(() => {});

    res.status(201).json(schedule);
  } catch (error) {
    console.error("createCalibrationSchedule error:", error);
    res.status(500).json({ message: "Failed to create calibration schedule" });
  }
};

export const getAllCalibrationSchedules = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { assetId, isActive } = req.query;

    // Department scoping: non-admin sees only their department's assets
    let scopedAssetIds: number[] | undefined;
    if (!["ADMIN", "CEO_COO", "FINANCE", "OPERATIONS"].includes(user?.role) && user?.departmentId) {
      const deptAssets = await prisma.asset.findMany({
        where: { departmentId: Number(user.departmentId) },
        select: { id: true },
      });
      scopedAssetIds = deptAssets.map(a => a.id);
    }

    const where: any = {};
    if (scopedAssetIds) {
      where.assetId = { in: scopedAssetIds };
    }
    if (assetId) where.assetId = Number(assetId);
    if (isActive !== undefined) where.isActive = isActive === "true";

    const schedules = await prisma.calibrationSchedule.findMany({
      where,
      include: {
        asset: { select: { assetId: true, assetName: true, assetType: true } },
        vendor: { select: { name: true } },
      },
      orderBy: { nextDueAt: "asc" },
    });

    res.json(schedules);
  } catch (error) {
    console.error("getAllCalibrationSchedules error:", error);
    res.status(500).json({ message: "Failed to fetch calibration schedules" });
  }
};

export const getCalibrationSchedulesByAsset = async (req: Request, res: Response) => {
  try {
    const assetId = parseInt(req.params.assetId);
    const schedules = await prisma.calibrationSchedule.findMany({
      where: { assetId },
      include: {
        vendor: { select: { name: true } },
        histories: { orderBy: { calibratedAt: "desc" }, take: 3 },
      },
      orderBy: { nextDueAt: "asc" },
    });
    res.json(schedules);
  } catch (error) {
    console.error("getCalibrationSchedulesByAsset error:", error);
    res.status(500).json({ message: "Failed to fetch schedules" });
  }
};

export const updateCalibrationSchedule = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const existing = await prisma.calibrationSchedule.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ message: "Schedule not found" });
      return;
    }

    const { nextDueAt, frequencyValue, frequencyUnit, isActive, vendorId, reminderDays, notes, standardProcedure } = req.body;

    const updated = await prisma.calibrationSchedule.update({
      where: { id },
      data: {
        nextDueAt: nextDueAt ? new Date(nextDueAt) : undefined,
        frequencyValue: frequencyValue ? Number(frequencyValue) : undefined,
        frequencyUnit,
        isActive,
        vendorId: vendorId ? Number(vendorId) : undefined,
        reminderDays: reminderDays ? Number(reminderDays) : undefined,
        notes,
        standardProcedure,
      },
      include: { asset: { select: { assetId: true, assetName: true, departmentId: true } } },
    });

    // Notify HOD about schedule update
    const updatedAssetDept = (updated as any).asset?.departmentId;
    if (updatedAssetDept) {
      getDepartmentHODs(updatedAssetDept).then(hodIds =>
        notify({
          type: "CALIBRATION",
          title: "Calibration Schedule Updated",
          message: `Calibration schedule for asset ${(updated as any).asset?.assetName} has been updated${nextDueAt ? `, next due ${new Date(nextDueAt).toLocaleDateString()}` : ""}`,
          recipientIds: hodIds,
          createdById: (req as any).user?.employeeDbId,
        })
      ).catch(() => {});
    }

    res.json(updated);
  } catch (error) {
    console.error("updateCalibrationSchedule error:", error);
    res.status(500).json({ message: "Failed to update calibration schedule" });
  }
};

export const deleteCalibrationSchedule = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const existing = await prisma.calibrationSchedule.findUnique({
      where: { id },
      include: { asset: { select: { assetId: true, assetName: true, departmentId: true } } },
    });
    if (!existing) {
      res.status(404).json({ message: "Schedule not found" });
      return;
    }
    await prisma.calibrationSchedule.delete({ where: { id } });

    // Notify HOD about schedule deletion
    const deletedAssetDept = (existing as any).asset?.departmentId;
    if (deletedAssetDept) {
      getDepartmentHODs(deletedAssetDept).then(hodIds =>
        notify({
          type: "CALIBRATION",
          title: "Calibration Schedule Deleted",
          message: `Calibration schedule for asset ${(existing as any).asset?.assetName} has been deleted`,
          recipientIds: hodIds,
          createdById: (req as any).user?.employeeDbId,
        })
      ).catch(() => {});
    }

    res.status(204).send();
  } catch (error) {
    console.error("deleteCalibrationSchedule error:", error);
    res.status(500).json({ message: "Failed to delete schedule" });
  }
};

export const getDueCalibrations = async (req: Request, res: Response) => {
  try {
    const daysAhead = parseInt((req.query.days as string) || "7");
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + daysAhead);

    const due = await prisma.calibrationSchedule.findMany({
      where: { nextDueAt: { lte: cutoff }, isActive: true },
      include: {
        asset: { select: { assetId: true, assetName: true, assetType: true, departmentId: true } },
        vendor: { select: { name: true, contact: true } },
      },
      orderBy: { nextDueAt: "asc" },
    });

    res.json(due);
  } catch (error) {
    console.error("getDueCalibrations error:", error);
    res.status(500).json({ message: "Failed to fetch due calibrations" });
  }
};

// ─── Calibration History ───────────────────────────────────────────────────────

export const logCalibrationHistory = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      assetId,
      scheduleId,
      calibratedAt,
      dueAt,
      calibratedByType,
      calibratedByName,
      vendorId,
      result,
      certificateNo,
      certificateUrl,
      remarks,
    } = req.body;

    if (!assetId) {
      res.status(400).json({ message: "assetId is required" });
      return;
    }

    const history = await prisma.calibrationHistory.create({
      data: {
        assetId: Number(assetId),
        scheduleId: scheduleId ? Number(scheduleId) : undefined,
        calibratedAt: calibratedAt ? new Date(calibratedAt) : new Date(),
        dueAt: dueAt ? new Date(dueAt) : undefined,
        calibratedByType,
        calibratedByName,
        vendorId: vendorId ? Number(vendorId) : undefined,
        result: result ?? "NA",
        certificateNo,
        certificateUrl,
        remarks,
        createdById: req.user?.employeeDbId,
      },
      include: {
        asset: { select: { assetId: true, assetName: true } },
        vendor: { select: { name: true } },
        createdBy: { select: { name: true } },
      },
    });

    // Advance next due date on linked schedule
    if (scheduleId) {
      const schedule = await prisma.calibrationSchedule.findUnique({ where: { id: Number(scheduleId) } });
      if (schedule) {
        const base = calibratedAt ? new Date(calibratedAt) : new Date();
        let nextDue = new Date(base);
        if (schedule.frequencyUnit === "DAYS") nextDue.setDate(nextDue.getDate() + schedule.frequencyValue);
        else if (schedule.frequencyUnit === "MONTHS") nextDue.setMonth(nextDue.getMonth() + schedule.frequencyValue);
        else if (schedule.frequencyUnit === "YEARS") nextDue.setFullYear(nextDue.getFullYear() + schedule.frequencyValue);

        await prisma.calibrationSchedule.update({
          where: { id: Number(scheduleId) },
          data: { nextDueAt: nextDue, lastCalibratedAt: base },
        });
      }
    }

    // Fire-and-forget: notify department HODs about calibration record
    const asset = await prisma.asset.findUnique({ where: { id: Number(assetId) }, select: { assetName: true, departmentId: true } });
    if (asset) {
      getDepartmentHODs(asset.departmentId).then(hodIds =>
        notify({
          type: "CALIBRATION",
          title: "Calibration Record Logged",
          message: `Calibration recorded for asset ${asset.assetName}, result: ${result ?? "NA"}`,
          recipientIds: hodIds,
          createdById: req.user?.employeeDbId,
        })
      ).catch(() => {});
    }

    res.status(201).json(history);
  } catch (error) {
    console.error("logCalibrationHistory error:", error);
    res.status(500).json({ message: "Failed to log calibration history" });
  }
};

export const getCalibrationHistoryByAsset = async (req: Request, res: Response) => {
  try {
    const assetId = parseInt(req.params.assetId);
    const history = await prisma.calibrationHistory.findMany({
      where: { assetId },
      include: {
        vendor: { select: { name: true } },
        createdBy: { select: { name: true, employeeID: true } },
      },
      orderBy: { calibratedAt: "desc" },
    });
    res.json(history);
  } catch (error) {
    console.error("getCalibrationHistoryByAsset error:", error);
    res.status(500).json({ message: "Failed to fetch calibration history" });
  }
};

// ─── Calibration Checklist Templates ──────────────────────────────────────────

export const createCalibrationTemplate = async (req: Request, res: Response) => {
  try {
    const { name, description, assetCategoryId, assetId, isActive } = req.body;

    if (!name) {
      res.status(400).json({ message: "name is required" });
      return;
    }

    const template = await prisma.calibrationChecklistTemplate.create({
      data: {
        name,
        description,
        assetCategoryId: assetCategoryId ? Number(assetCategoryId) : undefined,
        assetId: assetId ? Number(assetId) : undefined,
        isActive: isActive !== undefined ? Boolean(isActive) : true,
      },
      include: {
        assetCategory: { select: { name: true } },
        asset: { select: { assetId: true, assetName: true } },
      },
    });

    res.status(201).json(template);
  } catch (error) {
    console.error("createCalibrationTemplate error:", error);
    res.status(500).json({ message: "Failed to create calibration template" });
  }
};

export const getAllCalibrationTemplates = async (req: Request, res: Response) => {
  try {
    const { assetCategoryId, assetId } = req.query;
    const where: any = {};
    if (assetCategoryId) where.assetCategoryId = Number(assetCategoryId);
    if (assetId) where.assetId = Number(assetId);

    const templates = await prisma.calibrationChecklistTemplate.findMany({
      where,
      include: {
        assetCategory: { select: { name: true } },
        asset: { select: { assetId: true, assetName: true } },
        items: { orderBy: { sortOrder: "asc" } },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json(templates);
  } catch (error) {
    console.error("getAllCalibrationTemplates error:", error);
    res.status(500).json({ message: "Failed to fetch calibration templates" });
  }
};

export const addCalibrationTemplateItems = async (req: Request, res: Response) => {
  try {
    const templateId = parseInt(req.params.templateId);
    const { items } = req.body as {
      items: { title: string; description?: string; expectedValue?: string; unit?: string; sortOrder?: number; isRequired?: boolean }[];
    };

    if (!items?.length) {
      res.status(400).json({ message: "items array is required" });
      return;
    }

    const template = await prisma.calibrationChecklistTemplate.findUnique({ where: { id: templateId } });
    if (!template) {
      res.status(404).json({ message: "Template not found" });
      return;
    }

    const created = await prisma.$transaction(
      items.map((item, idx) =>
        prisma.calibrationChecklistItem.create({
          data: {
            templateId,
            title: item.title,
            description: item.description,
            expectedValue: item.expectedValue,
            unit: item.unit,
            sortOrder: item.sortOrder ?? idx,
            isRequired: item.isRequired !== undefined ? item.isRequired : true,
          },
        })
      )
    );

    res.status(201).json(created);
  } catch (error) {
    console.error("addCalibrationTemplateItems error:", error);
    res.status(500).json({ message: "Failed to add items" });
  }
};

export const updateCalibrationTemplate = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const existing = await prisma.calibrationChecklistTemplate.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ message: "Template not found" });
      return;
    }

    const updated = await prisma.calibrationChecklistTemplate.update({
      where: { id },
      data: req.body,
    });

    res.json(updated);
  } catch (error) {
    console.error("updateCalibrationTemplate error:", error);
    res.status(500).json({ message: "Failed to update template" });
  }
};

export const deleteCalibrationTemplate = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const existing = await prisma.calibrationChecklistTemplate.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ message: "Template not found" });
      return;
    }
    await prisma.calibrationChecklistItem.deleteMany({ where: { templateId: id } });
    await prisma.calibrationChecklistTemplate.delete({ where: { id } });
    res.status(204).send();
  } catch (error) {
    console.error("deleteCalibrationTemplate error:", error);
    res.status(500).json({ message: "Failed to delete template" });
  }
};

// ─── Calibration History PDF ──────────────────────────────────────────────────

export const getCalibrationHistoryPdf = async (req: Request, res: Response) => {
  try {
    const historyId = parseInt(req.params.id);

    const record = await prisma.calibrationHistory.findUnique({
      where: { id: historyId },
      include: {
        asset: {
          select: {
            assetId: true, assetName: true, serialNumber: true,
            department: { select: { name: true } },
            assetCategory: { select: { name: true } },
          },
        },
        schedule: { select: { id: true, frequencyValue: true, frequencyUnit: true, standardProcedure: true } },
        vendor: { select: { name: true } },
        createdBy: { select: { name: true, employeeID: true } },
      },
    });

    if (!record) {
      res.status(404).json({ message: "Calibration record not found" });
      return;
    }

    const fmt = (d: any) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
    const resultColor = record.result === 'PASS' ? '#16a34a' : record.result === 'FAIL' ? '#dc2626' : '#94a3b8';

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Calibration Certificate — ${(record as any).asset?.assetName || record.id}</title>
<style>
  @media print { body { margin: 0; } .no-print { display: none !important; } }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 12px; color: #1a1a1a; padding: 28px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #2563eb; padding-bottom: 15px; margin-bottom: 20px; }
  .header-left h1 { font-size: 18px; color: #2563eb; margin-bottom: 4px; }
  .header-left p { font-size: 11px; color: #666; }
  .header-right { text-align: right; font-size: 11px; color: #666; }
  .header-right strong { color: #1a1a1a; }
  .result-badge { display: inline-block; padding: 4px 14px; border-radius: 20px; font-size: 14px; font-weight: 700; color: #fff; background: ${resultColor}; margin-top: 6px; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px 16px; margin-bottom: 20px; padding: 12px; background: #f8fafc; border-radius: 6px; border: 1px solid #e2e8f0; }
  .info-item .label { display: block; font-size: 10px; color: #64748b; font-weight: 500; margin-bottom: 2px; text-transform: uppercase; letter-spacing: 0.4px; }
  .info-item .value { font-size: 12px; font-weight: 600; color: #0f172a; }
  .section-title { font-size: 12px; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: 0.5px; margin: 16px 0 8px; padding-bottom: 4px; border-bottom: 1px solid #e2e8f0; }
  .remarks-box { padding: 10px 12px; background: #fafafa; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 11px; color: #374151; min-height: 40px; }
  .cert-box { padding: 12px 16px; background: #f0fdf4; border: 1px solid #86efac; border-radius: 6px; display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
  .cert-box .cert-label { font-size: 10px; color: #166534; font-weight: 600; text-transform: uppercase; }
  .cert-box .cert-value { font-size: 14px; font-weight: 700; color: #15803d; }
  .signature-area { margin-top: 40px; display: flex; justify-content: space-between; }
  .signature-box { width: 180px; text-align: center; padding-top: 40px; border-top: 1px solid #333; font-size: 11px; }
  .footer { margin-top: 30px; padding-top: 12px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; font-size: 10px; color: #94a3b8; }
  .print-btn { position: fixed; top: 10px; right: 10px; padding: 8px 16px; background: #2563eb; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; z-index: 100; }
  .print-btn:hover { background: #1d4ed8; }
</style>
</head>
<body>
<button class="print-btn no-print" onclick="window.print()">Print / Save as PDF</button>

<div class="header">
  <div class="header-left">
    <h1>Calibration Certificate</h1>
    <p>${(record as any).asset?.assetName || '—'} &nbsp;|&nbsp; ${(record as any).asset?.assetId || '—'}</p>
  </div>
  <div class="header-right">
    <div><strong>Record #${record.id}</strong></div>
    <div>Generated: ${fmt(new Date())}</div>
    <div class="result-badge">${record.result}</div>
  </div>
</div>

${record.certificateNo ? `
<div class="cert-box">
  <div>
    <div class="cert-label">Certificate No.</div>
    <div class="cert-value">${record.certificateNo}</div>
  </div>
  ${record.certificateUrl ? `<div style="font-size:11px;color:#166534">📎 Certificate attached</div>` : ''}
</div>` : ''}

<div class="info-grid">
  <div class="info-item"><span class="label">Asset ID</span><span class="value">${(record as any).asset?.assetId || '—'}</span></div>
  <div class="info-item"><span class="label">Asset Name</span><span class="value">${(record as any).asset?.assetName || '—'}</span></div>
  <div class="info-item"><span class="label">Serial No.</span><span class="value">${(record as any).asset?.serialNumber || '—'}</span></div>
  <div class="info-item"><span class="label">Category</span><span class="value">${(record as any).asset?.assetCategory?.name || '—'}</span></div>
  <div class="info-item"><span class="label">Department</span><span class="value">${(record as any).asset?.department?.name || '—'}</span></div>
  <div class="info-item"><span class="label">Result</span><span class="value" style="color:${resultColor};font-weight:700">${record.result}</span></div>
  <div class="info-item"><span class="label">Calibrated At</span><span class="value">${fmt(record.calibratedAt)}</span></div>
  <div class="info-item"><span class="label">Next Due</span><span class="value">${fmt(record.dueAt)}</span></div>
  <div class="info-item"><span class="label">Calibrated By Type</span><span class="value">${record.calibratedByType || '—'}</span></div>
  <div class="info-item"><span class="label">Calibrated By</span><span class="value">${record.calibratedByName || (record as any).vendor?.name || '—'}</span></div>
  <div class="info-item"><span class="label">Logged By</span><span class="value">${(record as any).createdBy?.name || '—'}${(record as any).createdBy?.employeeID ? ' (' + (record as any).createdBy.employeeID + ')' : ''}</span></div>
  ${(record as any).schedule?.standardProcedure ? `<div class="info-item"><span class="label">Standard Ref.</span><span class="value">${(record as any).schedule.standardProcedure}</span></div>` : ''}
</div>

${record.remarks ? `
<div class="section-title">Remarks / Observations</div>
<div class="remarks-box">${record.remarks}</div>` : ''}

<div class="signature-area">
  <div class="signature-box">Calibrated By</div>
  <div class="signature-box">Verified By</div>
  <div class="signature-box">Approved By</div>
</div>

<div class="footer">
  <span>Smart Assets — Calibration Record #${record.id}</span>
  <span>Confidential</span>
</div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (e: any) {
    console.error("getCalibrationHistoryPdf error:", e);
    res.status(500).json({ message: e.message });
  }
};
