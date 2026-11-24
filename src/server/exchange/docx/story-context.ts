import type { XmlNode } from "../package";
import type { ReadContext } from "./read-context";

export interface StoryContext {
  context: ReadContext;
  inline: (node: XmlNode, baseStyle: any, paragraphId: string) => void;
  append: (content: string, style: any) => void;
  body: any;
  path: string;
  segment: string | undefined;
  bookmarks: Map<string, { start: number; name: string }>;
  fields: Array<{ code: string; start: number; show: boolean }>;
  paragraph: (node: XmlNode) => void;
  table: (node: XmlNode) => void;
}
