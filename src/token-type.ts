// Adapted from https://craftinginterpreters.com/scanning.html
// Adapted for Scheme use

export enum TokenType {
    // + - * / % ^ ! = < > & | ~ etc are recognized as IDENTIFIERS

    // Single-character tokens
    LEFT_PAREN, RIGHT_PAREN, 
    LEFT_BRACKET, RIGHT_BRACKET, 
    APOSTROPHE, BACKTICK, COMMA, HASH,

    // Two-character tokens
    COMMA_AT,

    // Literals
    IDENTIFIER, NUMBER, BOOLEAN, STRING,

    // SICP Chapter 1
    IF, LET, COND, ELSE, BEGIN, DEFINE, LAMBDA,

    // SICP Chapter 2
    QUOTE, UNQUOTE, QUASIQUOTE,
    
    // SICP Chapter 3
    SET, 
    
    VECTOR, UNQUOTE_SPLICING,

    EOF
}