"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const user_routes_1 = __importDefault(require("./user.routes"));
const property_routes_1 = __importDefault(require("./property.routes"));
const broker_routes_1 = __importDefault(require("./broker.routes"));
const admin_routes_1 = __importDefault(require("./admin.routes"));
const dashboard_routes_1 = __importDefault(require("./dashboard.routes"));
const auth_routes_1 = __importDefault(require("./auth.routes"));
const mainRoutes = (0, express_1.Router)();
mainRoutes.get('/', (req, res) => {
    return res.json({ message: 'API Imobiliária no ar!' });
});
mainRoutes.use('/auth', auth_routes_1.default);
mainRoutes.use('/users', user_routes_1.default);
mainRoutes.use('/brokers', broker_routes_1.default);
mainRoutes.use('/properties', property_routes_1.default);
mainRoutes.use('/admin', admin_routes_1.default);
mainRoutes.use('/admin/dashboard', dashboard_routes_1.default);
exports.default = mainRoutes;
