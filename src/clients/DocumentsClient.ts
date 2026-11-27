import type { RootsHttp, RequestOptions } from '../http/RootsHttp';

/** Minimal valid PDF, enough for sandbox KYC uploads. */
const TINY_PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

export class DocumentsClient {
  constructor(private readonly http: RootsHttp) {}
  upload(personId: string, type: string, extra: Record<string, string> = {}, opts: RequestOptions = {}) {
    return this.http.request<{ id: string }>('POST', '/api/v1/documents', {
      ...opts,
      multipart: {
        subject_type: 'person',
        subject_id: personId,
        type,
        ...extra,
        file: { name: `${type}.pdf`, mimeType: 'application/pdf', buffer: TINY_PDF },
      },
    });
  }
}
