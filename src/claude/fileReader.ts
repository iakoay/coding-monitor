import * as fs from 'fs';

/**
 * File reader utility with caching to avoid excessive disk I/O.
 */
export class FileReader {
    private cache = new Map<string, { content: string; mtime: number }>();

    readFile(filePath: string): string | null {
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

            let content: string;
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
            } else {
                content = fs.readFileSync(filePath, 'utf-8');
            }

            this.cache.set(filePath, { content, mtime: stat.mtimeMs });
            return content;
        } catch {
            return null;
        }
    }
}
