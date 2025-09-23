"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const DashboardController_1 = require("../controllers/DashboardController");
const auth_1 = require("../middlewares/auth");
const dashboardRoutes = (0, express_1.Router)();
dashboardRoutes.get('/stats', auth_1.authMiddleware, auth_1.isAdmin, DashboardController_1.dashboardController.getStats);
exports.default = dashboardRoutes;
