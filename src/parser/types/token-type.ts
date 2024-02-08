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
  // the procedure quote, quasiquote, unquote, and unquote-splicing
  // will all be represented as macros
  // the default usage will be these characters instead
  APOSTROPHE,     // Quote
  BACKTICK,       // Quasiquote
  COMMA,          // Unquote
  COMMA_AT,       // Unquote-splicing

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
