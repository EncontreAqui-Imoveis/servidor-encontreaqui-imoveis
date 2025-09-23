"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const PropertyController_1 = require("../controllers/PropertyController");
const publicRoutes = (0, express_1.Router)();
publicRoutes.get('/properties', PropertyController_1.propertyController.listPublicProperties);
publicRoutes.get('/properties/:id', PropertyController_1.propertyController.show);
publicRoutes.get('/properties/cities', PropertyController_1.propertyController.getAvailableCities);
exports.default = publicRoutes;
