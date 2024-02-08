import { Tokenizer } from "./lexer/tokenizer";
import { SExpressionParser } from "./s-expression-generator/s-expression-parser";
import { Expression } from "./types/node-types";

export * as TokenizerError from "./lexer/tokenizer-error";
export * as ParserError from "./parser-error";

export function schemeParse(source: string, chapter?: number): Expression[] {
  const tokenizer = new Tokenizer(source);
  const parser = new SExpressionParser(source, tokenizer.scanTokens());
  return parser.parse();
}
