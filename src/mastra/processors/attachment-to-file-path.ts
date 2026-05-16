import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import type { MastraDBMessage } from '@mastra/core/memory';
import type {
  ProcessInputArgs,
  ProcessInputStepArgs,
  Processor,
} from '@mastra/core/processors';

type MessagePart = MastraDBMessage['content']['parts'][number];

type FilePart = MessagePart & {
  type: 'file';
  mediaType?: string;
  mimeType?: string;
  url?: string;
  data?: string;
  filename?: string;
};

type TextPart = MessagePart & {
  type: 'text';
  text: string;
};

const UPLOADS_DIR = 'uploads';
const DATA_URL_PREFIX = 'data:';
const ATTACHMENT_TEXT_PREFIX = /^<attachment\s+name=(['"]?)([^>'"\r\n]+)\1>\s*/i;

type SavedAttachmentInfo = {
  uploadPath: string;
};

export class AttachmentToFilePathProcessor implements Processor {
  id = 'attachment-to-file-path';

  constructor(private readonly workspaceBasePath: string) {}

  async processInput({ messages, state }: ProcessInputArgs): Promise<MastraDBMessage[]> {
    return this.rewriteMessages(messages, state);
  }

  async processInputStep({ messages, state }: ProcessInputStepArgs): Promise<MastraDBMessage[]> {
    return this.rewriteMessages(messages, state);
  }

  private async rewriteMessages(
    messages: MastraDBMessage[],
    state: Record<string, unknown>
  ): Promise<MastraDBMessage[]> {
    const savedFiles = this.getSavedFiles(state);

    return Promise.all(
      messages.map(async (message) => {
        const parts = message.content.parts ?? [];
        const rewrittenParts: MessagePart[] = [];
        const savedAttachmentsForMessage: SavedAttachmentInfo[] = [];

        for (const part of parts) {
          if (this.isInlineFilePart(part)) {
            const savedAttachment = await this.persistFilePart(part, savedFiles);
            if (!savedAttachment) {
              rewrittenParts.push(part);
              continue;
            }

            savedAttachmentsForMessage.push(savedAttachment);
            continue;
          }

          if (this.isAttachmentTextPart(part)) {
            const savedAttachment = await this.persistAttachmentTextPart(part, savedFiles);
            if (!savedAttachment) {
              rewrittenParts.push(part);
              continue;
            }

            savedAttachmentsForMessage.push(savedAttachment);
            continue;
          }

          if (!this.isInlineFilePart(part)) {
            rewrittenParts.push(part);
            continue;
          }
        }

        if (!savedAttachmentsForMessage.length) {
          return message;
        }

        rewrittenParts.push({
          type: 'text',
          text: this.buildPathNote(savedAttachmentsForMessage),
        } as MessagePart);

        return {
          ...message,
          content: {
            ...message.content,
            parts: rewrittenParts,
            content: rewrittenParts
              .filter((part): part is Extract<MessagePart, { type: 'text' }> => part.type === 'text')
              .map((part) => part.text)
              .join(''),
          },
        };
      })
    );
  }

  private isInlineFilePart(part: MessagePart): part is FilePart {
    if (part.type !== 'file') {
      return false;
    }

    const candidate = part as FilePart & Record<string, unknown>;
    const url = candidate['url'];
    if (typeof url === 'string' && url.startsWith(DATA_URL_PREFIX)) {
      return true;
    }

    const data = candidate['data'];
    return typeof data === 'string' && typeof this.getFileMediaType(candidate as FilePart) === 'string';
  }

  private isAttachmentTextPart(part: MessagePart): part is TextPart {
    return part.type === 'text' && ATTACHMENT_TEXT_PREFIX.test(part.text);
  }

  private async persistFilePart(
    part: FilePart,
    savedFiles: Map<string, string>
  ): Promise<SavedAttachmentInfo | null> {
    const dataUrl = this.getFileDataUrl(part);
    if (!dataUrl) {
      return null;
    }

    const existingAttachment = savedFiles.get(dataUrl);
    if (existingAttachment) {
      return this.deserializeSavedAttachment(existingAttachment);
    }

    const parsed = this.parseDataUrl(dataUrl);
    if (!parsed) {
      return null;
    }

    const fileName = this.buildFileName(part.filename, parsed.mediaType);
    const relativePath = join(UPLOADS_DIR, fileName).replace(/\\/g, '/');
    const absolutePath = join(this.workspaceBasePath, relativePath);

    await mkdir(join(this.workspaceBasePath, UPLOADS_DIR), { recursive: true });
    await writeFile(absolutePath, parsed.buffer);
    console.log(`[AttachmentToFilePathProcessor] saved ${relativePath}`);

    const savedAttachment = { uploadPath: relativePath };
    savedFiles.set(dataUrl, this.serializeSavedAttachment(savedAttachment));
    return savedAttachment;
  }

  private async persistAttachmentTextPart(
    part: TextPart,
    savedFiles: Map<string, string>
  ): Promise<SavedAttachmentInfo | null> {
    const match = ATTACHMENT_TEXT_PREFIX.exec(part.text);
    if (!match) {
      return null;
    }

    const rawFileName = match[2];
    if (!rawFileName) {
      return null;
    }

    const fileBody = part.text.slice(match[0].length);
    const cacheKey = `text:${rawFileName}:${fileBody}`;
    const existingAttachment = savedFiles.get(cacheKey);
    if (existingAttachment) {
      return this.deserializeSavedAttachment(existingAttachment);
    }

    const fileName = this.buildFileName(rawFileName, this.mediaTypeFromFileName(rawFileName));
    const relativePath = join(UPLOADS_DIR, fileName).replace(/\\/g, '/');
    const absolutePath = join(this.workspaceBasePath, relativePath);

    await mkdir(join(this.workspaceBasePath, UPLOADS_DIR), { recursive: true });
    await writeFile(absolutePath, fileBody, 'utf8');
    console.log(`[AttachmentToFilePathProcessor] saved ${relativePath}`);

    const savedAttachment = { uploadPath: relativePath };
    savedFiles.set(cacheKey, this.serializeSavedAttachment(savedAttachment));
    return savedAttachment;
  }

  private parseDataUrl(dataUrl: string): { buffer: Buffer; mediaType: string } | null {
    const match = /^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,(.+)$/i.exec(dataUrl);
    if (!match) {
      return null;
    }

    const mediaType = match[1] ?? 'application/octet-stream';
    const base64Payload = match[2];
    if (!base64Payload) {
      return null;
    }

    return {
      mediaType,
      buffer: Buffer.from(base64Payload, 'base64'),
    };
  }

  private getFileDataUrl(part: FilePart): string | null {
    if (typeof part.url === 'string' && part.url.startsWith(DATA_URL_PREFIX)) {
      return part.url;
    }

    if (typeof part.data !== 'string') {
      return null;
    }

    const mediaType = this.getFileMediaType(part) ?? 'application/octet-stream';
    return `data:${mediaType};base64,${part.data}`;
  }

  private getFileMediaType(part: FilePart): string | undefined {
    return part.mediaType ?? part.mimeType;
  }

  private buildFileName(originalName: string | undefined, mediaType: string): string {
    const safeBaseName = this.sanitizeBaseName(originalName ?? `upload-${randomUUID()}`);
    if (extname(safeBaseName)) {
      return safeBaseName;
    }

    const extension = this.extensionForMediaType(mediaType);
    return extension ? `${safeBaseName}${extension}` : safeBaseName;
  }

  private sanitizeBaseName(fileName: string): string {
    const normalized = basename(fileName).replace(/[^a-zA-Z0-9._-]/g, '-');
    return normalized || `upload-${randomUUID()}`;
  }

  private extensionForMediaType(mediaType: string): string {
    switch (mediaType.toLowerCase()) {
      case 'text/csv':
        return '.csv';
      case 'application/json':
        return '.json';
      case 'text/plain':
        return '.txt';
      case 'application/pdf':
        return '.pdf';
      default:
        return '';
    }
  }

  private mediaTypeFromFileName(fileName: string): string {
    const extension = extname(fileName).toLowerCase();
    switch (extension) {
      case '.csv':
        return 'text/csv';
      case '.json':
        return 'application/json';
      case '.txt':
        return 'text/plain';
      case '.pdf':
        return 'application/pdf';
      default:
        return 'application/octet-stream';
    }
  }

  private buildPathNote(savedAttachments: SavedAttachmentInfo[]): string {
    const sections = savedAttachments.map((savedAttachment) => {
      return [
        'File saved to workspace:',
        savedAttachment.uploadPath,
        '',
        'Use the workspace read_file tool to inspect it.',
      ].join('\n');
    });

    return `${sections.join('\n\n')}\nUse the workspace read_file tool to inspect them.`;
  }

  private serializeSavedAttachment(savedAttachment: SavedAttachmentInfo): string {
    return JSON.stringify(savedAttachment);
  }

  private deserializeSavedAttachment(value: string): SavedAttachmentInfo {
    try {
      const parsed = JSON.parse(value) as SavedAttachmentInfo;
      if (typeof parsed.uploadPath === 'string') {
        return parsed;
      }
    } catch {
      // Fall back to the legacy string-only format.
    }

    return { uploadPath: value };
  }

  private getSavedFiles(state: Record<string, unknown>): Map<string, string> {
    const existing = state.savedAttachmentPaths;
    if (existing instanceof Map) {
      return existing as Map<string, string>;
    }

    const savedFiles = new Map<string, string>();
    state.savedAttachmentPaths = savedFiles;
    return savedFiles;
  }
}