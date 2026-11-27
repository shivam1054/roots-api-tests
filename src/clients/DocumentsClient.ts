import type { RootsHttp, RequestOptions } from '../http/RootsHttp';
import type { DocumentSummary, DocumentType, Page } from '../models/types';

/** Minimal valid PDF, enough for sandbox KYC uploads. */
const TINY_PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

export interface UploadOptions extends RequestOptions {
  /** Defaults to "person", the only value the API accepts. Override for negative tests. */
  subjectType?: string;
  /** Send the form without a file part (negative test). */
  omitFile?: boolean;
}

/** POST /api/v1/documents: multipart upload of a KYC/KYB document for a person. */
export class DocumentsClient {
  constructor(private readonly http: RootsHttp) {}

  upload(personId: string, type: DocumentType | string, extra: Record<string, string> = {}, opts: UploadOptions = {}) {
    const { subjectType = 'person', omitFile = false, ...requestOpts } = opts;
    return this.http.request<DocumentSummary>('POST', '/api/v1/documents', {
      ...requestOpts,
      multipart: {
        subject_type: subjectType,
        subject_id: personId,
        type,
        ...extra,
        ...(omitFile ? {} : { file: { name: `${type}.pdf`, mimeType: 'application/pdf', buffer: TINY_PDF } }),
      },
    });
  }

  list(personId: string, opts: RequestOptions = {}) {
    return this.http.request<Page<DocumentSummary>>('GET', '/api/v1/documents', { ...opts, query: { subject_type: 'person', subject_id: personId } });
  }
}
