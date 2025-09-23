"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const routes_1 = __importDefault(require("./routes"));
const public_routes_1 = __importDefault(require("./routes/public.routes"));
const app = (0, express_1.default)();
const PORT = process.env.API_PORT || 3333;
app.use((0, cors_1.default)());
app.use(express_1.default.json());
app.use(routes_1.default);
app.use(public_routes_1.default);
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
