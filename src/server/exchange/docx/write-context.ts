import type { Snapshot } from "../../../shared/documents/model";
import type { CodecOptions, Diagnostic } from "../../../shared/exchange";
import type { XmlNode } from "../package";
import type { Package } from "../package";

export interface WriteContext {
  relationshipsByPart: Map<
    string,
    Array<{ Id: string; Type: string; Target: string; TargetMode?: string }>
  >;
  originalParts: Package;
  serial: number;
  parts: Package;
  snapshot: Snapshot;
  headerParts: Map<string, string>;
  addRel: (
    part: string,
    type: string,
    target: string,
    external?: boolean,
  ) => string;
  noteIds: Map<string, number>;
  diagnostics: Diagnostic[];
  newContentTypes: Map<string, string>;
  originalTrees: Map<string, XmlNode[]>;
  originalParagraphs: Record<string, any>;
  rawParagraph: (info: any) => XmlNode | undefined;
  sectionXml: (config: any, part: string) => string;
  options: CodecOptions;
  numberIds: Map<string, number>;
  imageXml: (id: string, body: any, part: string) => string;
}
