import type { Multer } from "multer";
import type { AuthUserPayload } from "../../middleware/authMiddleware";

declare global {
  namespace Express {
    interface Request {
      user?: AuthUserPayload;
      file?: Multer.File;
      files?: Multer.File[];
    }
  }
}

export {};