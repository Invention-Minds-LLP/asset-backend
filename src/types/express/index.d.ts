import { Multer } from "multer";

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: number;
        role: string;
        name?: string;
      };
      file?: Multer.File;
      files?: Multer.File[];
    }
  }
}

export {};
