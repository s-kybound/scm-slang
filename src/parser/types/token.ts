/**
 * A data structure representing a particular token.
 */

import { Position } from "./location";
import { TokenType } from "./token-type";

export class Token {
  type: TokenType;
  lexeme: string;
  literal: any;
  start: number;
  end: number;
  pos: Position;
  endPos: Position;

  constructor(
    type: TokenType,
    lexeme: any,
    literal: any,
    start: number,
    end: number,
    line: number,
    col: number,
  ) {
    this.type = type;
    this.lexeme = lexeme;
    this.literal = literal;
    this.start = start;
    this.end = end;
    this.pos = new Position(line, col);
    this.endPos = new Position(line, col + lexeme.length - 1);
  }
  
  /**
   * For debugging.
   * @returns A string representation of the token.
   */
  public toString(): string {
    return `${this.lexeme}`;
  }
}
