"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.FileReader = void 0;
const fs = __importStar(require("fs"));
/**
 * File reader utility with caching to avoid excessive disk I/O.
 */
class FileReader {
    constructor() {
        this.cache = new Map();
    }
    readFile(filePath) {
        try {
            const stat = fs.statSync(filePath);
            const cached = this.cache.get(filePath);
            // Return cached content if file hasn't changed
            if (cached && cached.mtime === stat.mtimeMs) {
                return cached.content;
            }
            // Read the file - for large session files, read only the last portion
            const fileSize = stat.size;
            const maxReadSize = 2 * 1024 * 1024; // 2MB max read
            let content;
            if (fileSize > maxReadSize) {
                const buffer = Buffer.alloc(maxReadSize);
                const fd = fs.openSync(filePath, 'r');
                fs.readSync(fd, buffer, 0, maxReadSize, fileSize - maxReadSize);
                fs.closeSync(fd);
                content = buffer.toString('utf-8');
                const firstNewline = content.indexOf('\n');
                if (firstNewline !== -1) {
                    content = content.substring(firstNewline + 1);
                }
            }
            else {
                content = fs.readFileSync(filePath, 'utf-8');
            }
            this.cache.set(filePath, { content, mtime: stat.mtimeMs });
            return content;
        }
        catch {
            return null;
        }
    }
}
exports.FileReader = FileReader;
//# sourceMappingURL=fileReader.js.map