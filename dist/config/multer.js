"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDocumentPath = exports.documentUpload = void 0;
const crypto_1 = __importDefault(require("crypto"));
const fs_1 = __importDefault(require("fs"));
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const documentsRoot = path_1.default.resolve(__dirname, "..", "..", "uploads", "docs");
const documentsStorage = multer_1.default.diskStorage({
    destination: (req, file, cb) => {
        fs_1.default.mkdir(documentsRoot, { recursive: true }, (mkdirError) => {
            cb(mkdirError ?? null, documentsRoot);
        });
    },
    filename: (req, file, cb) => {
        crypto_1.default.randomBytes(16, (err, hash) => {
            if (err) {
                return cb(err, file.originalname);
            }
            const fileName = `${hash.toString("hex")}-${file.originalname}`;
            cb(null, fileName);
        });
    },
});
exports.documentUpload = (0, multer_1.default)({ storage: documentsStorage });
const getDocumentPath = (fileName) => path_1.default.join(documentsRoot, fileName);
exports.getDocumentPath = getDocumentPath;
