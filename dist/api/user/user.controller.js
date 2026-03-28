"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteUser = exports.createUser = exports.getAllUsers = exports.resetPassword = exports.loginUser = void 0;
const prismaClient_1 = __importDefault(require("../../prismaClient"));
const bcrypt_1 = __importDefault(require("bcrypt"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const JWT_SECRET = process.env.JWT_SECRET || "your_default_secret";
const loginUser = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e;
    const { employeeId, password } = req.body;
    if (!employeeId || !password) {
        res.status(400).json({ message: "Employee ID and password are required" });
        return;
    }
    const user = yield prismaClient_1.default.user.findUnique({ where: { employeeID: employeeId }, include: { employee: true }, });
    const clientIp = req.ip; // or req.headers["x-forwarded-for"]
    const userAgent = req.headers["user-agent"] || "unknown";
    if (!user) {
        res.status(401).json({ message: "Invalid username or password" });
        return;
    }
    const isPasswordValid = yield bcrypt_1.default.compare(password, user.passwordHash);
    // Log the login attempt BEFORE responding:
    yield prismaClient_1.default.loginHistory.create({
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
        return;
    }
    // Successful login → update lastLogin
    yield prismaClient_1.default.user.update({
        where: { id: user.id },
        data: { lastLogin: new Date() },
    });
    // Generate JWT token
    const token = jsonwebtoken_1.default.sign({
        userId: user.id,
        employeeID: user.employeeID,
        employeeDbId: (_a = user.employee) === null || _a === void 0 ? void 0 : _a.id, // ADD THIS
        role: user.role,
        name: (_b = user.employee) === null || _b === void 0 ? void 0 : _b.name,
        departmentId: (_c = user.employee) === null || _c === void 0 ? void 0 : _c.departmentId
    }, JWT_SECRET, { expiresIn: "12h" });
    res.json({
        message: "Login successful",
        token,
        user: {
            id: user.id,
            username: user.username,
            employeeID: user.employeeID,
            employeeDbId: user.employee.id,
            role: user.role,
            name: (_d = user.employee) === null || _d === void 0 ? void 0 : _d.name,
            lastLogin: new Date(),
            departmentId: (_e = user.employee) === null || _e === void 0 ? void 0 : _e.departmentId
        },
    });
    return;
});
exports.loginUser = loginUser;
const resetPassword = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { employeeID, newPassword } = req.body;
    if (!employeeID || !newPassword) {
        res.status(400).json({ message: "employeeID and newPassword are required" });
        return;
    }
    const user = yield prismaClient_1.default.user.findUnique({ where: { employeeID } });
    if (!user) {
        res.status(404).json({ message: "User not found" });
        return;
    }
    const hashedPassword = yield bcrypt_1.default.hash(newPassword, 10);
    yield prismaClient_1.default.user.update({
        where: { employeeID },
        data: { passwordHash: hashedPassword },
    });
    res.json({ message: "Password reset successful" });
});
exports.resetPassword = resetPassword;
const getAllUsers = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const users = yield prismaClient_1.default.user.findMany({ include: { employee: true } });
    res.json(users);
});
exports.getAllUsers = getAllUsers;
const createUser = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { username, password, role, employeeID } = req.body;
    if (!username || !password || !role || !employeeID) {
        res.status(400).json({ message: "Missing required fields" });
        return;
    }
    const hashedPassword = yield bcrypt_1.default.hash(password, 10); // ✅ hash the password securely
    const user = yield prismaClient_1.default.user.create({
        data: {
            username,
            passwordHash: hashedPassword, // ✅ store the hashed password
            role,
            employeeID: employeeID, // assuming your User.employeeID is linked to Employee.employeeId (string)
        },
    });
    res.status(201).json(user);
    return;
});
exports.createUser = createUser;
const deleteUser = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const id = parseInt(req.params.id);
    yield prismaClient_1.default.user.delete({ where: { id } });
    res.status(204).send();
});
exports.deleteUser = deleteUser;
