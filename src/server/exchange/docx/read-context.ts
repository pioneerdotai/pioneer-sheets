import type { Snapshot } from "../../../shared/documents/model";
import type { Diagnostic } from "../../../shared/exchange";
import type { XmlNode } from "../package";
import type { Package } from "../package";

export interface ReadContext {
  parts: Package;
  warn: (code: string, message: string, location?: string) => void;
  snapshot: Snapshot;
  headerIds: Map<string, string>;
  extras: any;
  tree: (path: string) => XmlNode;
  parseStory: (root: XmlNode, path: string, segment?: string) => any;
  paragraphIndexes: Map<string, Map<XmlNode, number>>;
  resolved: (
    id: string | undefined,
    seen?: Set<string>,
  ) => { text: any; paragraph: any };
  image: (node: XmlNode, body: any, path: string, segment?: string) => void;
  equation: (node: XmlNode, body: any) => void;
  noteRefs: Set<string>;
  pDefaults: any;
  styles: Map<string, XmlNode>;
  numbering: Map<string, any>;
  defaults: any;
  diagnostics: Diagnostic[];
  section: (node: XmlNode | undefined, path: string) => any;
  globalSection: number;
}
