import { Request, Response } from "express";
import prisma from "../../prismaClient";

export const getAllLoginHistory = async (req: Request, res: Response) => {
  try {
    const { userId, success, dateFrom, dateTo, page = "1", limit = "25", search, exportCsv } = req.query;

    const where: any = {};
    if (userId) where.userId = Number(userId);
    if (success !== undefined) where.success = success === "true";
    if (dateFrom || dateTo) {
      where.attemptedAt = {};
      if (dateFrom) where.attemptedAt.gte = new Date(String(dateFrom));
      if (dateTo) where.attemptedAt.lte = new Date(String(dateTo));
    }
    if (search) {
      where.OR = [
        { ipAddress: { contains: String(search) } },
        { user: { username: { contains: String(search) } } },
        { user: { employee: { name: { contains: String(search) } } } },
      ];
    }

    const skip = (parseInt(String(page)) - 1) * parseInt(String(limit));
    const take = parseInt(String(limit));

    const [total, history] = await Promise.all([
      prisma.loginHistory.count({ where }),
      prisma.loginHistory.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              username: true,
              employeeID: true,
              role: true,
              employee: { select: { name: true, departmentId: true } },
            },
          },
        },
        orderBy: { attemptedAt: "desc" },
        ...(exportCsv !== "true" ? { skip, take } : {}),
      }),
    ]);

    if (exportCsv === "true") {
      const csvRows = history.map((h: any) => ({
        Username: h.user?.username || "",
        EmployeeName: h.user?.employee?.name || "",
        Role: h.user?.role || "",
        AttemptedAt: h.attemptedAt ? new Date(h.attemptedAt).toISOString() : "",
        Success: h.success ? "Yes" : "No",
        IpAddress: h.ipAddress || "",
        UserAgent: h.userAgent || "",
      }));

      const headers = Object.keys(csvRows[0] || {}).join(",");
      const rows = csvRows.map((r: any) => Object.values(r).join(",")).join("\n");
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=login-history.csv");
      res.send(headers + "\n" + rows);
      return;
    }

    res.json({ data: history, total, page: parseInt(String(page)), limit: take });
  } catch (error) {
    console.error("getAllLoginHistory error:", error);
    res.status(500).json({ message: "Failed to fetch login history" });
  }
};

// ─── User Activity Stats ─────────────────────────────────────────────────────
export const getUserActivityStats = async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const [totalLogins, todayLogins, failedToday, recentActiveUsers, last7DayLogins] = await Promise.all([
      prisma.loginHistory.count(),
      prisma.loginHistory.count({ where: { attemptedAt: { gte: today }, success: true } }),
      prisma.loginHistory.count({ where: { attemptedAt: { gte: today }, success: false } }),
      prisma.loginHistory.findMany({
        where: { success: true, attemptedAt: { gte: sevenDaysAgo } },
        select: { userId: true },
        distinct: ["userId"],
      }),
      prisma.loginHistory.count({ where: { attemptedAt: { gte: sevenDaysAgo } } }),
    ]);

    // Last login per user (most recent successful logins)
    const recentLogins = await prisma.user.findMany({
      where: { lastLogin: { not: null } },
      select: {
        id: true,
        username: true,
        role: true,
        lastLogin: true,
        employee: { select: { name: true } },
      },
      orderBy: { lastLogin: "desc" },
      take: 20,
    });

    res.json({
      totalLogins,
      todayLogins,
      failedToday,
      activeUsersLast7Days: recentActiveUsers.length,
      last7DayLogins,
      recentLogins,
    });
  } catch (error) {
    console.error("getUserActivityStats error:", error);
    res.status(500).json({ message: "Failed to fetch user activity stats" });
  }
};
