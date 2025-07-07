import { Request, Response } from "express";
import prisma from "../../prismaClient";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "your_default_secret";

export const loginUser = async (req: Request, res: Response) => {
  const { employeeId, password } = req.body;

  if (!employeeId || !password) {
     res.status(400).json({ message: "Employee ID and password are required" });
     return;
  }

  const user = await prisma.user.findUnique({ where: { employeeID: employeeId } });

  const clientIp = req.ip; // or req.headers["x-forwarded-for"]
  const userAgent = req.headers["user-agent"] || "unknown";

  if (!user) {
     res.status(401).json({ message: "Invalid username or password" });
     return;
  }

  const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

  // Log the login attempt BEFORE responding:
  await prisma.loginHistory.create({
    data: {
      userId: user.id,
      attemptedAt: new Date(),
      ipAddress: clientIp,
      userAgent,
      success: isPasswordValid,
    },
  });

  if (!isPasswordValid) {
     res.status(401).json({ message: "Invalid username or password" });
     return
  }

  // Successful login → update lastLogin
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLogin: new Date() },
  });

  // Generate JWT token
  const token = jwt.sign(
    {
      userId: user.id,
      employeeID: user.employeeID,
      role: user.role,
    },
    JWT_SECRET,
    { expiresIn: "12h" }
  );

   res.json({
    message: "Login successful",
    token,
    user: {
      id: user.id,
      username: user.username,
      employeeID: user.employeeID,
      role: user.role,
      lastLogin: new Date(),
    },
  });
  return;
};

export const getAllUsers = async (req: Request, res: Response) => {
  const users = await prisma.user.findMany({ include: { employee: true } });
   res.json(users);
};

export const createUser = async (req: Request, res: Response) => {
  const { username, password, role, employeeID } = req.body;

  if (!username || !password || !role || !employeeID) {
     res.status(400).json({ message: "Missing required fields" });
     return
  }

  const hashedPassword = await bcrypt.hash(password, 10); // ✅ hash the password securely

  const user = await prisma.user.create({
    data: {
      username,
      passwordHash: hashedPassword, // ✅ store the hashed password
      role,
      employeeID: employeeID,       // assuming your User.employeeID is linked to Employee.employeeId (string)
    },
  });

   res.status(201).json(user);
   return
};

export const deleteUser = async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  await prisma.user.delete({ where: { id } });
   res.status(204).send();
};
