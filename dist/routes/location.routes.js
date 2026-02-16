"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const LocationController_1 = require("../controllers/LocationController");
const locationRoutes = (0, express_1.Router)();
locationRoutes.get('/cep/:cep', (req, res) => LocationController_1.locationController.getByCep(req, res));
exports.default = locationRoutes;
