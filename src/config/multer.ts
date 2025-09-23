import crypto from "crypto";
import fs from "fs";
import multer from "multer";
import path from "path";

const documentsRoot = path.resolve(__dirname, "..", "..", "uploads", "docs");

const documentsStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    fs.mkdir(documentsRoot, { recursive: true }, (mkdirError) => {
      cb(mkdirError ?? null, documentsRoot);
    });
  },
  filename: (req, file, cb) => {
    crypto.randomBytes(16, (err, hash) => {
      if (err) {
        return cb(err, file.originalname);
      }
      const fileName = `${hash.toString("hex")}-${file.originalname}`;
      cb(null, fileName);
    });
  },
});

export const documentUpload = multer({ storage: documentsStorage });

export const getDocumentPath = (fileName: string) => path.join(documentsRoot, fileName);
