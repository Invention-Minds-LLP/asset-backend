import express from "express";
import assetRoutes from "./api/assets/assets.routes";
import warrantyRoutes from "./api/warranty/warranty.routes";
import ticketRoutes from "./api/tickets/tickets.routes";
import assetCategoryRoutes from "./api/assetCategory/assetCategory.routes";
import departmentRoutes from "./api/department/department.routes";
import employeeRoutes from "./api/employee/employee.routes";
import vendorRoutes from "./api/vendor/vendor.routes";
import maintenanceHistoryRoutes from "./api/maintenanceHistory/maintenanceHistory.routes";
import userRoutes from "./api/user/user.routes";
import loginHistoryRoutes from "./api/loginHistory/loginHistory.routes";
import emailRoutes from "./api/email/email.routes";
import locationRoutes from "./api/location/location.routes";
import transferRoutes from "./api/transfer/transfer.routes";
import insuranceRoutes from "./api/insurance/insurance.routes";
import depreciationRoutes from "./api/depreciation/depreciation.routes";
import branchRoutes from "./api/branches/branches.routes";



import cors from "cors";

const app = express();
const port = 3001;

// Middleware to parse JSON bodies
app.use(express.json());

app.use(cors({
  origin: "http://localhost:4200", // Allow your Angular app
  credentials: true               // Optional: if you plan to send cookies
}));

// Mount routers
app.use("/api/assets", assetRoutes);
app.use("/api/warranties", warrantyRoutes);
app.use("/api/tickets", ticketRoutes);
app.use("/api/categories", assetCategoryRoutes);
app.use("/api/departments", departmentRoutes);
app.use("/api/employees", employeeRoutes);
app.use("/api/vendors", vendorRoutes);
app.use("/api/maintenance-history", maintenanceHistoryRoutes);
app.use("/api/users", userRoutes);
app.use("/api/login-history", loginHistoryRoutes);
app.use("/api/email", emailRoutes);

app.use("/api/branches", branchRoutes);
app.use("/api/location", locationRoutes);
app.use("/api/transfers", transferRoutes);
app.use("/api/insurance", insuranceRoutes);
app.use("/api/depreciation", depreciationRoutes);


// Default route
app.get("/", (req, res) => {
  res.send("✅ Asset Management API is running!");
});

// Error handler middleware (optional, but good practice)
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: "Internal Server Error" });
});

// Start the server
app.listen(port, '0.0.0.0',() => {
  console.log(`🚀 Server running at http://127.0.0.1:${port}/`);
});
