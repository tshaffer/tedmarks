import { DeleteObjectCommand, GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { Readable } from 'node:stream';

/** Where menu pages are kept (Amazon S3; in memory in tests). Pages never change once stored. */
export interface MenuPageStore {
  put(id: string, mediaType: string, bytes: Buffer): Promise<void>;
  /** The page's bytes, or undefined if there's no such page. */
  get(id: string): Promise<{ mediaType: string; bytes: Readable | Buffer; size?: number | undefined } | undefined>;
  delete(id: string): Promise<void>;
}

const key = (id: string) => `menu-pages/${id}`;

/** A private S3 bucket. Credentials come from AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY. */
export class S3MenuPageStore implements MenuPageStore {
  private readonly client: S3Client;

  constructor(region: string, private readonly bucket: string) {
    this.client = new S3Client({ region });
  }

  async put(id: string, mediaType: string, bytes: Buffer): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key(id), Body: bytes, ContentType: mediaType }));
  }

  async get(id: string) {
    try {
      const object = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key(id) }));
      if (!object.Body) return undefined;
      return { mediaType: object.ContentType ?? 'application/octet-stream', bytes: object.Body as Readable, size: object.ContentLength };
    } catch (error) {
      if (error instanceof NoSuchKey) return undefined;
      throw error;
    }
  }

  async delete(id: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key(id) }));
  }
}

export class MemoryMenuPageStore implements MenuPageStore {
  readonly pages = new Map<string, { mediaType: string; bytes: Buffer }>();
  async put(id: string, mediaType: string, bytes: Buffer) { this.pages.set(id, { mediaType, bytes }); }
  async get(id: string) { return this.pages.get(id); }
  async delete(id: string) { this.pages.delete(id); }
}
