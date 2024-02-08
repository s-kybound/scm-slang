// Adapted from https://craftinginterpreters.com/scanning.html
// Adapted for Scheme use

export enum TokenType {
  // + - * / % ^ ! = < > & | ~ etc are recognized as symbols

  // Single-character tokens
  LEFT_PAREN,
  RIGHT_PAREN,
  LEFT_BRACKET,   // Two bracket types are offered for better readability
  RIGHT_BRACKET,

  // Quotation syntax
  APOSTROPHE,     // Quote
  BACKTICK,       // Quasiquote
  COMMA,          // Unquote
  COMMA_AT,       // Unquote-splicing
  QUOTE,
  QUASIQUOTE,
  UNQUOTE,
  UNQUOTE_SPLICING,

  // List syntax
  DOT,            // Pair notation
  TRIPLE_DOT,     // Rest argument notation

  // Vector syntax
  HASH,

  // Atoms: Literals
  NUMBER,
  BOOLEAN,
  STRING,

  // Atoms: Symbols
  SYMBOL,

  EOF,
}
