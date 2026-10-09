declare module "pdf-parse" {
  export default function pdfParse(
    dataBuffer: Buffer,
  ): Promise<{
    text: string;
    numpages: number;
    info?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }>;
}

declare module "word-extractor" {
  export default class WordExtractor {
    extract(filePath: string): Promise<{
      getBody(): string;
    }>;
  }
}
