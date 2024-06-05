import { Token } from "../types/tokens/token";
import { TokenType } from "../types/tokens/token-type";
import { Location } from "../types/location";
import { Atomic, Expression, Extended } from "../types/nodes/scheme-node-types";
import * as ParserError from "./parser-error";
import { Datum } from "../types/tokens/datum";
import { Group } from "../types/tokens/group";
import { Parser } from "./parser";
import { isGroup, isToken } from "../types/tokens";

/**
 * An enum representing the current quoting mode of the parser
 */
enum QuoteMode {
  NONE,
  QUOTE,
  QUASIQUOTE,
}

export class SchemeParser implements Parser {
  private readonly source: string;
  private readonly tokens: Token[];
  private readonly chapter: number;
  private current: number = 0;
  private quoteMode: QuoteMode = QuoteMode.NONE;

  // We can group syntactical elements by their chapter
  private readonly BASIC_CHAPTER = 1;
  private readonly QUOTING_CHAPTER = 2;
  private readonly VECTOR_CHAPTER = 3;
  private readonly MUTABLE_CHAPTER = 3;

  constructor(source: string, tokens: Token[], chapter: number = Infinity) {
    this.source = source;
    this.tokens = tokens;
    this.chapter = chapter;
  }

  private advance(): Token {
    if (!this.isAtEnd()) this.current++;
    return this.previous();
  }

  private isAtEnd(): boolean {
    return this.current >= this.tokens.length;
  }

  private previous(): Token {
    return this.tokens[this.current - 1];
  }

  private peek(): Token {
    return this.tokens[this.current];
  }

  private validateChapter(c: Token, chapter: number): void {
    if (this.chapter < chapter) {
      throw new ParserError.DisallowedTokenError(
        this.source,
        c.pos,
        c,
        this.chapter
      );
    }
  }

  /**
   * Returns the location of a token.
   * @param token A token.
   * @returns The location of the token.
   */
  private toLocation(token: Token): Location {
    return new Location(token.pos, token.endPos);
  }

  /**
   * Helper function used to destructure a list into its elements and terminator.
   * An optional verifier is used if there are restrictions on the elements of the list.
   */
  private destructureList(
    list: Datum[],
    verifier = (_x: any) => {}
  ): [Expression[], Expression | undefined] {
    // check if the list is an empty list
    if (list.length === 0) {
      return [[], undefined];
    }

    // check if the list is a list of length 1
    if (list.length === 1) {
      verifier(list[0]);
      return [[this.parseExpression(list[0])], undefined];
    }

    // we now know that the list is at least of length 2

    // check for a dotted list
    // it is if the second last element is a dot
    const potentialDot = list.at(-2) as Datum;

    if (isToken(potentialDot) && potentialDot.type === TokenType.DOT) {
      const cdrElement = list.at(-1)!;
      const listElements = list.slice(0, -2);
      verifier(cdrElement);
      listElements.forEach(verifier);
      return [
        listElements.map(this.parseExpression.bind(this)),
        this.parseExpression(cdrElement),
      ];
    }

    // we now know that it is a proper list
    const listElements = list;
    listElements.forEach(verifier);
    return [listElements.map(this.parseExpression.bind(this)), undefined];
  }

  /**
   * Returns a group of associated tokens.
   * Tokens are grouped by level of parentheses.
   *
   * @param openparen The opening parenthesis, if one exists.
   * @returns A group of tokens or groups of tokens.
   */
  private grouping(openparen?: Token): Group | undefined {
    const elements: Datum[] = [];
    let inList = false;
    if (openparen) {
      inList = true;
      elements.push(openparen);
    }
    do {
      let c = this.advance();
      switch (c.type) {
        case TokenType.LEFT_PAREN:
        case TokenType.LEFT_BRACKET:
          // the next group is not empty, especially because it
          // has an open parenthesis
          const innerGroup = this.grouping(c) as Group;
          elements.push(innerGroup);
          break;
        case TokenType.RIGHT_PAREN:
        case TokenType.RIGHT_BRACKET:
          if (!inList) {
            throw new ParserError.UnexpectedFormError(this.source, c.pos, c);
          }
          // add the parenthesis to the current group
          elements.push(c);
          inList = false;
          break;
        case TokenType.APOSTROPHE: // Quoting syntax (short form)
        case TokenType.BACKTICK:
        case TokenType.COMMA:
        case TokenType.COMMA_AT:
        case TokenType.HASH_VECTOR: // Vector syntax
          // these cases modify only the next element
          // so we group up the next element and use this
          // token on it
          let nextGrouping;
          do {
            nextGrouping = this.grouping();
          } while (!nextGrouping);
          elements.push(this.affect(c, nextGrouping));
          break;
        case TokenType.QUOTE: // Quoting syntax
        case TokenType.QUASIQUOTE:
        case TokenType.UNQUOTE:
        case TokenType.UNQUOTE_SPLICING:
        case TokenType.IDENTIFIER: // Atomics
        case TokenType.NUMBER:
        case TokenType.BOOLEAN:
        case TokenType.STRING:
        case TokenType.DOT:

        case TokenType.DEFINE: // Chapter 1
        case TokenType.IF:
        case TokenType.ELSE:
        case TokenType.COND:
        case TokenType.LAMBDA:
        case TokenType.LET:
        case TokenType.SET: // Chapter 3
        case TokenType.BEGIN:
        case TokenType.DELAY:
        case TokenType.IMPORT:
        case TokenType.EXPORT:
        case TokenType.JS_IMPORT:
        case TokenType.JS_EXPORT:
          elements.push(c);
          break;
        case TokenType.HASH_SEMICOLON:
          // a datum comment
          // get the next NON-EMPTY grouping
          // and ignore it
          while (!this.grouping()) {}
          break;
        case TokenType.EOF:
          // We should be unable to reach this point at top level as parse()
          // should prevent the grouping of the singular EOF token.
          // However, with any element that ranges beyond the end of the
          // file without its corresponding delemiter, we can reach this point.
          throw new ParserError.UnexpectedEOFError(this.source, c.pos);
        default:
          throw new ParserError.UnexpectedFormError(this.source, c.pos, c);
      }
    } while (inList);
    if (elements.length === 0) {
      return;
    }

    try {
      return Group.build(elements);
    } catch (e) {
      if (e instanceof ParserError.ExpectedFormError) {
        throw new ParserError.ExpectedFormError(
          this.source,
          e.loc,
          e.form,
          e.expected
        );
      }
      throw e;
    }
  }

  /**
   * Groups an affector token with its target.
   */
  private affect(affector: Token, target: Datum): Group {
    return Group.build([affector, target]);
  }

  /**
   * Parse an expression.
   * @param expr A token or a group of tokens.
   * @returns
   */
  private parseExpression(expr: Datum): Expression {
    // Discern the type of expression
    if (isToken(expr)) {
      return this.parseToken(expr);
    }

    // We now know it is a group

    // Due to group invariants we can determine if it represents a
    // single token instead
    if (expr.isSingleIdentifier()) {
      return this.parseToken(expr.unwrap()[0] as Token);
    }

    return this.parseGroup(expr);
  }

  private parseToken(token: Token): Expression {
    switch (token.type) {
      case TokenType.IDENTIFIER:
        return this.quoteMode === QuoteMode.NONE
          ? new Atomic.Identifier(this.toLocation(token), token.lexeme)
          : new Atomic.Symbol(this.toLocation(token), token.lexeme);
      // all of these are self evaluating, and so can be left alone regardless of quote mode
      case TokenType.NUMBER:
        return new Atomic.NumericLiteral(
          this.toLocation(token),
          token.literal as string
        );
      case TokenType.BOOLEAN:
        return new Atomic.BooleanLiteral(
          this.toLocation(token),
          token.literal as boolean
        );
      case TokenType.STRING:
        return new Atomic.StringLiteral(
          this.toLocation(token),
          token.literal as string
        );
      default:
        // if in a quoting context, any keyword is instead treated as a symbol
        if (this.quoteMode !== QuoteMode.NONE) {
          return new Atomic.Symbol(this.toLocation(token), token.lexeme);
        }
        throw new ParserError.UnexpectedFormError(
          this.source,
          token.pos,
          token
        );
    }
  }

  private parseGroup(group: Group): Expression {
    // No need to check if group represents a single token as well
    if (!group.isParenthesized()) {
      // The only case left is the unparenthesized case
      // of a single affector token and a target group
      // Form: <affector token> <group>
      return this.parseAffectorGroup(group);
    }
    // Now we have fallen through to the generic group
    // case - a parenthesized group of tokens.
    switch (this.quoteMode) {
      case QuoteMode.NONE:
        return this.parseNormalGroup(group);
      case QuoteMode.QUOTE:
      case QuoteMode.QUASIQUOTE:
        return this.parseQuotedGroup(group);
    }
  }

  /**
   * Parse a group of tokens affected by an affector.
   * Important case as affector changes quotation mode.
   *
   * @param group A group of tokens, verified to be an affector and a target.
   * @returns An expression.
   */
  parseAffectorGroup(group: Group): Expression {
    const [affector, target] = group.unwrap();
    // Safe to cast affector due to group invariants
    switch ((<Token>affector).type) {
      case TokenType.APOSTROPHE:
      case TokenType.QUOTE:
        this.validateChapter(<Token>affector, this.QUOTING_CHAPTER);
        if (this.quoteMode !== QuoteMode.NONE) {
          const innerGroup = this.parseExpression(target);
          const newSymbol = new Atomic.Symbol(
            this.toLocation(<Token>affector),
            "quote"
          );

          const newLocation = newSymbol.location.merge(innerGroup.location);
          // wrap the entire expression in a list
          return new Extended.List(newLocation, [newSymbol, innerGroup]);
        }
        this.quoteMode = QuoteMode.QUOTE;
        const quotedExpression = this.parseExpression(target);
        this.quoteMode = QuoteMode.NONE;
        return quotedExpression;
      case TokenType.BACKTICK:
      case TokenType.QUASIQUOTE:
        this.validateChapter(<Token>affector, this.QUOTING_CHAPTER);
        if (this.quoteMode !== QuoteMode.NONE) {
          const innerGroup = this.parseExpression(target);
          const newSymbol = new Atomic.Symbol(
            this.toLocation(<Token>affector),
            "quasiquote"
          );

          const newLocation = newSymbol.location.merge(innerGroup.location);
          // wrap the entire expression in a list
          return new Extended.List(newLocation, [newSymbol, innerGroup]);
        }
        this.quoteMode = QuoteMode.QUASIQUOTE;
        const quasiquotedExpression = this.parseExpression(target);
        this.quoteMode = QuoteMode.NONE;
        return quasiquotedExpression;
      case TokenType.COMMA:
      case TokenType.UNQUOTE:
        this.validateChapter(<Token>affector, this.QUOTING_CHAPTER);
        let preUnquoteMode = this.quoteMode;
        if (preUnquoteMode === QuoteMode.NONE) {
          throw new ParserError.UnsupportedTokenError(
            this.source,
            (<Token>affector).pos,
            <Token>affector
          );
        }
        if (preUnquoteMode === QuoteMode.QUOTE) {
          const innerGroup = this.parseExpression(target);
          const newSymbol = new Atomic.Symbol(
            this.toLocation(<Token>affector),
            "unquote"
          );

          const newLocation = newSymbol.location.merge(innerGroup.location);
          // wrap the entire expression in a list
          return new Extended.List(newLocation, [newSymbol, innerGroup]);
        }
        this.quoteMode = QuoteMode.NONE;
        const unquotedExpression = this.parseExpression(target);
        this.quoteMode = preUnquoteMode;
        return unquotedExpression;
      case TokenType.COMMA_AT:
      case TokenType.UNQUOTE_SPLICING:
        // Unquote-splicing will be evaluated at runtime,
        // Proper unquote splicing will be dealt with in semester 2.

        this.validateChapter(<Token>affector, this.QUOTING_CHAPTER);
        let preUnquoteSplicingMode = this.quoteMode;
        if (preUnquoteSplicingMode === QuoteMode.NONE) {
          throw new ParserError.UnexpectedFormError(
            this.source,
            (<Token>affector).pos,
            <Token>affector
          );
        }
        if (preUnquoteSplicingMode === QuoteMode.QUOTE) {
          const innerGroup = this.parseExpression(target);
          const newSymbol = new Atomic.Symbol(
            this.toLocation(<Token>affector),
            "unquote-splicing"
          );

          const newLocation = newSymbol.location.merge(innerGroup.location);
          // wrap the entire expression in a list
          return new Extended.List(newLocation, [newSymbol, innerGroup]);
        }
        throw new ParserError.UnsupportedTokenError(
          this.source,
          (<Token>affector).pos,
          <Token>affector
        );
        this.quoteMode = QuoteMode.NONE;
        const unquoteSplicedExpression = this.parseExpression(target);
        this.quoteMode = preUnquoteSplicingMode;
        const newLocation = this.toLocation(<Token>affector).merge(
          unquoteSplicedExpression.location
        );
        return new Atomic.SpliceMarker(newLocation, unquoteSplicedExpression);
      case TokenType.HASH_VECTOR:
        // vectors quote over all elements inside.
        this.validateChapter(<Token>affector, this.VECTOR_CHAPTER);
        let preVectorQuoteMode = this.quoteMode;
        this.quoteMode = QuoteMode.QUOTE;
        const vector = this.parseVector(group);
        this.quoteMode = preVectorQuoteMode;
        return vector;
      default:
        throw new ParserError.UnexpectedFormError(
          this.source,
          (<Token>affector).pos,
          <Token>affector
        );
    }
  }

  private parseNormalGroup(group: Group): Expression {
    // it is an error if the group is empty in a normal context
    if (group.length() === 0) {
      throw new ParserError.ExpectedFormError(
        this.source,
        group.location.start,
        group,
        "non-empty group"
      );
    }

    // get the first element
    const firstElement = group.unwrap()[0];

    // If the first element is a token, it may be a keyword or a procedure call
    if (isToken(firstElement)) {
      switch (firstElement.type) {
        // Scheme chapter 1
        case TokenType.LAMBDA:
          this.validateChapter(firstElement, this.BASIC_CHAPTER);
          return this.parseLambda(group);
        case TokenType.DEFINE:
          this.validateChapter(firstElement, this.BASIC_CHAPTER);
          return this.parseDefinition(group);
        case TokenType.IF:
          this.validateChapter(firstElement, this.BASIC_CHAPTER);
          return this.parseConditional(group);
        case TokenType.LET:
          this.validateChapter(firstElement, this.BASIC_CHAPTER);
          return this.parseLet(group);
        case TokenType.COND:
          this.validateChapter(firstElement, this.BASIC_CHAPTER);
          return this.parseExtendedCond(group);

        // Scheme chapter 2
        case TokenType.QUOTE:
        case TokenType.APOSTROPHE:
        case TokenType.QUASIQUOTE:
        case TokenType.BACKTICK:
        case TokenType.UNQUOTE:
        case TokenType.COMMA:
        case TokenType.UNQUOTE_SPLICING:
        case TokenType.COMMA_AT:
          this.validateChapter(firstElement, this.QUOTING_CHAPTER);
          // we can reuse the affector group method to control the quote mode
          return this.parseAffectorGroup(group);

        // Scheme chapter 3
        case TokenType.BEGIN:
          this.validateChapter(firstElement, this.MUTABLE_CHAPTER);
          return this.parseBegin(group);
        case TokenType.DELAY:
          this.validateChapter(firstElement, this.MUTABLE_CHAPTER);
          return this.parseDelay(group);
        case TokenType.SET:
          this.validateChapter(firstElement, this.MUTABLE_CHAPTER);
          return this.parseSet(group);

        // Scm-slang misc
        case TokenType.IMPORT:
          this.validateChapter(firstElement, this.BASIC_CHAPTER);
          return this.parseImport(group);
        case TokenType.JS_IMPORT:
          this.validateChapter(firstElement, this.BASIC_CHAPTER);
          return this.parseImport(group, true);
        case TokenType.EXPORT:
          this.validateChapter(firstElement, this.BASIC_CHAPTER);
          return this.parseExport(group);
        case TokenType.JS_EXPORT:
          this.validateChapter(firstElement, this.BASIC_CHAPTER);
          return this.parseExport(group, true);
        case TokenType.VECTOR:
          this.validateChapter(firstElement, this.VECTOR_CHAPTER);
          // same as above, this is an affector group
          return this.parseAffectorGroup(group);

        default:
          // It's a procedure call
          return this.parseApplication(group);
      }
    }
    // Form: (<group> <expr>*)
    // It's a procedure call
    return this.parseApplication(group);
  }

  /**
   * We are parsing a list/dotted list.
   */
  private parseQuotedGroup(group: Group): Expression {
    // check if the group is an empty list
    if (group.length() === 0) {
      return new Atomic.Nil(group.location);
    }

    // check if the group is a list of length 1
    if (group.length() === 1) {
      const elem = [this.parseExpression(group.unwrap()[0])];
      return new Extended.List(group.location, elem);
    }

    // we now know that the group is at least of length 2

    const groupElements = group.unwrap();

    const [listElements, cdrElement] = this.destructureList(groupElements);

    return new Extended.List(group.location, listElements, cdrElement);
  }

  // _____________________CHAPTER 1_____________________

  /**
   * Parse a lambda expression.
   * @param group
   * @returns
   */
  private parseLambda(group: Group): Atomic.Lambda {
    // Form: (lambda (<identifier>*) <body>+)
    //     | (lambda (<identifier>* . <rest-identifier>) <body>+)
    // ensure that the group has at least 3 elements
    if (group.length() < 3) {
      throw new ParserError.ExpectedFormError(
        this.source,
        group.location.start,
        group,
        "(lambda (<identifier>* . <rest-identifier>?) <body>+) | (lambda <rest-identifer> <body>+)"
      );
    }
    const elements = group.unwrap();
    const formals = elements[1];
    const body = elements.slice(2);

    // Formals should be a group of identifiers or a single identifier
    let convertedFormals: Atomic.Identifier[] = [];
    // if a rest element is detected,
    let convertedRest: Atomic.Identifier | undefined = undefined;
    if (isToken(formals)) {
      if (formals.type !== TokenType.IDENTIFIER) {
        throw new ParserError.ExpectedFormError(
          this.source,
          formals.pos,
          formals,
          "<rest-identifier>"
        );
      }
      convertedRest = new Atomic.Identifier(
        this.toLocation(formals),
        formals.lexeme
      );
    } else {
      // it is a group
      const formalsElements = formals.unwrap();
      [convertedFormals, convertedRest] = this.destructureList(
        formalsElements,
        // pass in a verifier that checks if the elements are identifiers
        formal => {
          if (!isToken(formal)) {
            throw new ParserError.ExpectedFormError(
              this.source,
              formal.pos,
              formal,
              "<identifier>"
            );
          }
          if (formal.type !== TokenType.IDENTIFIER) {
            throw new ParserError.ExpectedFormError(
              this.source,
              formal.pos,
              formal,
              "<identifier>"
            );
          }
        }
      ) as [Atomic.Identifier[], Atomic.Identifier | undefined];
    }

    // Body is treated as a group of expressions
    const convertedBody = body.map(
      this.parseExpression.bind(this)
    ) as Expression[];

    // assert that body is not empty
    if (convertedBody.length < 1) {
      throw new ParserError.ExpectedFormError(
        this.source,
        group.location.start,
        group,
        "(lambda ... <body>+)"
      );
    }

    if (convertedBody.length === 1) {
      return new Atomic.Lambda(
        group.location,
        convertedBody[0],
        convertedFormals,
        convertedRest
      );
    }

    const newLocation = convertedBody
      .at(0)!
      .location.merge(convertedBody.at(-1)!.location);
    const bodySequence = new Atomic.Sequence(newLocation, convertedBody);
    return new Atomic.Lambda(
      group.location,
      bodySequence,
      convertedFormals,
      convertedRest
    );
  }

  /**
   * Parse a define expression.
   * @param group
   * @returns
   */
  private parseDefinition(
    group: Group
  ): Atomic.Definition | Extended.FunctionDefinition {
    // Form: (define <identifier> <expr>)
    //     | (define (<identifier> <formals>) <body>)
    //     | (define (<identifier> <formals>) <body> <body>*)
    // ensure that the group has at least 3 elements
    if (group.length() < 3) {
      throw new ParserError.ExpectedFormError(
        this.source,
        group.location.start,
        group,
        "(define <identifier> <expr>) | (define (<identifier> <formals>) <body>+)"
      );
    }
    const elements = group.unwrap();
    const identifier = elements[1];
    const expr = elements.slice(2);

    let convertedIdentifier: Atomic.Identifier;
    let convertedFormals: Atomic.Identifier[] = [];
    let convertedRest: Atomic.Identifier | undefined = undefined;
    let isFunctionDefinition = false;

    // Identifier may be a token or a group of identifiers
    if (isGroup(identifier)) {
      // its a function definition
      isFunctionDefinition = true;
      const identifierElements = identifier.unwrap();
      const functionName = identifierElements[0];
      const formals = identifierElements.splice(1);

      // verify that the first element is an identifier
      if (!isToken(functionName)) {
        throw new ParserError.ExpectedFormError(
          this.source,
          functionName.location.start,
          functionName,
          "<identifier>"
        );
      }
      if (functionName.type !== TokenType.IDENTIFIER) {
        throw new ParserError.ExpectedFormError(
          this.source,
          functionName.pos,
          functionName,
          "<identifier>"
        );
      }

      // convert the first element to an identifier
      convertedIdentifier = new Atomic.Identifier(
        this.toLocation(functionName),
        functionName.lexeme
      );

      // Formals should be a group of identifiers
      [convertedFormals, convertedRest] = this.destructureList(
        formals,
        formal => {
          if (!isToken(formal)) {
            throw new ParserError.ExpectedFormError(
              this.source,
              formal.pos,
              formal,
              "<identifier>"
            );
          }
          if (formal.type !== TokenType.IDENTIFIER) {
            throw new ParserError.ExpectedFormError(
              this.source,
              formal.pos,
              formal,
              "<identifier>"
            );
          }
        }
      ) as [Atomic.Identifier[], Atomic.Identifier | undefined];
    } else if (identifier.type !== TokenType.IDENTIFIER) {
      throw new ParserError.ExpectedFormError(
        this.source,
        identifier.pos,
        identifier,
        "<identifier>"
      );
    } else {
      // its a normal definition
      convertedIdentifier = new Atomic.Identifier(
        this.toLocation(identifier),
        identifier.lexeme
      );
      isFunctionDefinition = false;
    }

    // expr cannot be empty
    if (expr.length < 1) {
      throw new ParserError.ExpectedFormError(
        this.source,
        group.location.start,
        group,
        "(define ... <body>+)"
      );
    }

    if (isFunctionDefinition) {
      // Body is treated as a group of expressions
      const convertedBody = expr.map(
        this.parseExpression.bind(this)
      ) as Expression[];

      if (convertedBody.length === 1) {
        return new Extended.FunctionDefinition(
          group.location,
          convertedIdentifier,
          convertedBody[0],
          convertedFormals,
          convertedRest
        );
      }

      const newLocation = convertedBody
        .at(0)!
        .location.merge(convertedBody.at(-1)!.location);
      const bodySequence = new Atomic.Sequence(newLocation, convertedBody);

      return new Extended.FunctionDefinition(
        group.location,
        convertedIdentifier,
        bodySequence,
        convertedFormals,
        convertedRest
      );
    }

    // its a normal definition

    if (expr.length > 1) {
      throw new ParserError.ExpectedFormError(
        this.source,
        group.location.start,
        group,
        "(define <identifier> <expr>)"
      );
    }

    // Expr is treated as a single expression
    const convertedExpr = this.parseExpression(expr[0]);

    return new Atomic.Definition(
      group.location,
      convertedIdentifier,
      convertedExpr
    );
  }

  /**
   * Parse a conditional expression.
   * @param group
   * @returns
   */
  private parseConditional(group: Group): Atomic.Conditional {
    // Form: (if <pred> <cons> <alt>)
    //     | (if <pred> <cons>)

    // ensure that the group has 3 or 4 elements
    if (group.length() < 3 || group.length() > 4) {
      throw new ParserError.ExpectedFormError(
        this.source,
        group.location.start,
        group,
        "(if <pred> <cons> <alt>?)"
      );
    }
    const elements = group.unwrap();
    const test = elements[1];
    const consequent = elements[2];
    const alternate = group.length() > 3 ? elements[3] : undefined;

    // Test is treated as a single expression
    const convertedTest = this.parseExpression(test);

    // Consequent is treated as a single expression
    const convertedConsequent = this.parseExpression(consequent);

    // Alternate is treated as a single expression

    const convertedAlternate = alternate
      ? this.parseExpression(alternate)
      : new Atomic.Identifier(group.location, "undefined");

    return new Atomic.Conditional(
      group.location,
      convertedTest,
      convertedConsequent,
      convertedAlternate
    );
  }

  /**
   * Parse an application expression.
   */
  private parseApplication(group: Group): Atomic.Application {
    // Form: (<func> <args>*)
    // ensure that the group has at least 1 element
    if (group.length() < 1) {
      throw new ParserError.ExpectedFormError(
        this.source,
        group.location.start,
        group,
        "(<func> <args>*)"
      );
    }
    const elements = group.unwrap();
    const operator = elements[0];
    const operands = elements.splice(1);

    // Operator is treated as a single expression
    const convertedOperator = this.parseExpression(operator);

    // Operands are treated as a group of expressions
    const convertedOperands: Expression[] = [];
    for (const operand of operands) {
      convertedOperands.push(this.parseExpression(operand));
    }

    return new Atomic.Application(
      group.location,
      convertedOperator,
      convertedOperands
    );
  }

  /**
   * Parse a let expression.
   * @param group
   * @returns
   */
  private parseLet(group: Group): Extended.Let {
    // Form: (let ((<identifier> <value>)*) <body>+)
    // ensure that the group has at least 3 elements
    if (group.length() < 3) {
      throw new ParserError.ExpectedFormError(
        this.source,
        group.location.start,
        group,
        "(let ((<identifier> <value>)*) <body>+)"
      );
    }
    const elements = group.unwrap();
    const bindings = elements[1];
    const body = elements.slice(2);

    // Verify bindings is a group
    if (!isGroup(bindings)) {
      throw new ParserError.ExpectedFormError(
        this.source,
        bindings.pos,
        bindings,
        "((<identifier> <value>)*)"
      );
    }

    // Bindings are treated as a group of grouped identifiers and values
    const convertedIdentifiers: Atomic.Identifier[] = [];
    const convertedValues: Expression[] = [];

    const bindingElements = bindings.unwrap();
    for (const bindingElement of bindingElements) {
      // Verify bindingElement is a group of size 2
      if (!isGroup(bindingElement)) {
        throw new ParserError.ExpectedFormError(
          this.source,
          bindingElement.pos,
          bindingElement,
          "(<identifier> <value>)"
        );
      }
      if (bindingElement.length() !== 2) {
        throw new ParserError.ExpectedFormError(
          this.source,
          bindingElement.location.start,
          bindingElement,
          "(<identifier> <value>)"
        );
      }

      const [identifier, value] = bindingElement.unwrap();

      // Verify identifier is a token and an identifier
      if (!isToken(identifier)) {
        throw new ParserError.ExpectedFormError(
          this.source,
          identifier.location.start,
          identifier,
          "<identifier>"
        );
      }
      if (identifier.type !== TokenType.IDENTIFIER) {
        throw new ParserError.ExpectedFormError(
          this.source,
          identifier.pos,
          identifier,
          "<identifier>"
        );
      }
      convertedIdentifiers.push(
        new Atomic.Identifier(this.toLocation(identifier), identifier.lexeme)
      );
      convertedValues.push(this.parseExpression(value));
    }

    // Body is treated as a group of expressions
    const convertedBody = body.map(
      this.parseExpression.bind(this)
    ) as Expression[];

    // assert that body is not empty
    if (convertedBody.length < 1) {
      throw new ParserError.ExpectedFormError(
        this.source,
        group.location.start,
        group,
        "(let ... <body>+)"
      );
    }

    if (convertedBody.length === 1) {
      return new Extended.Let(
        group.location,
        convertedIdentifiers,
        convertedValues,
        convertedBody[0]
      );
    }

    const newLocation = convertedBody
      .at(0)!
      .location.merge(convertedBody.at(-1)!.location);
    const bodySequence = new Atomic.Sequence(newLocation, convertedBody);

    return new Extended.Let(
      group.location,
      convertedIdentifiers,
      convertedValues,
      bodySequence
    );
  }

  /**
   * Parse an extended cond expression.
   * @param group
   * @returns
   */
  private parseExtendedCond(group: Group): Extended.Cond {
    // Form: (cond (<pred> <body>)*)
    //     | (cond (<pred> <body>)* (else <val>))
    // ensure that the group has at least 2 elements
    if (group.length() < 2) {
      throw new ParserError.ExpectedFormError(
        this.source,
        group.location.start,
        group,
        "(cond (<pred> <body>*)* (else <val>)?)"
      );
    }
    const elements = group.unwrap();
    const clauses = elements.splice(1);
    // safe to cast because of the check above
    const lastClause = <Datum>clauses.pop();

    // Clauses are treated as a group of groups of expressions
    // Form: (<pred> <body>*)
    const convertedClauses: Expression[] = [];
    const convertedConsequents: Expression[] = [];

    for (const clause of clauses) {
      // Verify clause is a group with size no less than 1
      if (!isGroup(clause)) {
        throw new ParserError.ExpectedFormError(
          this.source,
          clause.pos,
          clause,
          "(<pred> <body>*)"
        );
      }
      if (clause.length() < 1) {
        throw new ParserError.ExpectedFormError(
          this.source,
          clause.firstToken().pos,
          clause.firstToken(),
          "(<pred> <body>*)"
        );
      }

      const [test, ...consequent] = clause.unwrap();

      // verify that test is NOT an else token
      if (isToken(test) && test.type === TokenType.ELSE) {
        throw new ParserError.ExpectedFormError(
          this.source,
          test.pos,
          test,
          "<predicate>"
        );
      }

      // Test is treated as a single expression
      const convertedTest = this.parseExpression(test);

      // Consequent is treated as a group of expressions
      const consequentExpressions = consequent.map(
        this.parseExpression.bind(this)
      ) as Expression[];
      const consequentLocation =
        consequent.length < 1
          ? convertedTest.location
          : consequentExpressions
              .at(0)!
              .location.merge(consequentExpressions.at(-1)!.location);

      // if consequent is empty, the test itself is treated
      // as the value returned.
      // if consequent is more than length one, there is a sequence.
      const convertedConsequent =
        consequent.length < 1
          ? convertedTest
          : consequent.length < 2
            ? consequentExpressions[0]
            : new Atomic.Sequence(consequentLocation, consequentExpressions);

      convertedClauses.push(convertedTest);
      convertedConsequents.push(convertedConsequent);
    }

    // Check last clause
    // Verify lastClause is a group with size at least 2
    if (!isGroup(lastClause)) {
      throw new ParserError.ExpectedFormError(
        this.source,
        lastClause.pos,
        lastClause,
        "(<pred> <body>+) | (else <val>)"
      );
    }

    if (lastClause.length() < 2) {
      throw new ParserError.ExpectedFormError(
        this.source,
        lastClause.firstToken().pos,
        lastClause.firstToken(),
        "(<pred> <body>+) | (else <val>)"
      );
    }

    const [test, ...consequent] = lastClause.unwrap();

    let isElse = false;

    // verify that test is an else token
    if (isToken(test) && test.type === TokenType.ELSE) {
      isElse = true;
      // verify that consequent is of length 1
      if (consequent.length !== 1) {
        throw new ParserError.ExpectedFormError(
          this.source,
          lastClause.location.start,
          lastClause,
          "(else <val>)"
        );
      }
    }

    // verify that consequent is at least 1 expression
    if (consequent.length < 1) {
      throw new ParserError.ExpectedFormError(
        this.source,
        lastClause.location.start,
        lastClause,
        "(<pred> <body>+)"
      );
    }

    // Consequent is treated as a group of expressions
    const consequentExpressions = consequent.map(
      this.parseExpression.bind(this)
    ) as Expression[];
    const consequentLocation = consequentExpressions
      .at(0)!
      .location.merge(consequentExpressions.at(-1)!.location);
    const lastConsequent =
      consequent.length === 1
        ? consequentExpressions[0]
        : new Atomic.Sequence(consequentLocation, consequentExpressions);

    if (isElse) {
      return new Extended.Cond(
        group.location,
        convertedClauses,
        convertedConsequents,
        lastConsequent
      );
    }

    // If the last clause is not an else clause, we treat it as a normal cond clause instead
    const lastTest = this.parseExpression(test);

    // Test
    convertedClauses.push(lastTest);
    convertedConsequents.push(lastConsequent);

    return new Extended.Cond(
      group.location,
      convertedClauses,
      convertedConsequents
    );
  }

  // _____________________CHAPTER 3_____________________

  /**
   * Parse a reassignment expression.
   * @param group
   * @returns
   */
  private parseSet(group: Group): Atomic.Reassignment {
    // Form: (set! <identifier> <expr>)
    // ensure that the group has 3 elements
    if (group.length() !== 3) {
      throw new ParserError.ExpectedFormError(
        this.source,
        group.location.start,
        group,
        "(set! <identifier> <expr>)"
      );
    }
    const elements = group.unwrap();
    const identifier = elements[1];
    const expr = elements[2];

    // Identifier is treated as a single identifier
    if (isGroup(identifier)) {
      throw new ParserError.ExpectedFormError(
        this.source,
        identifier.location.start,
        identifier,
        "<identifier>"
      );
    }
    if (identifier.type !== TokenType.IDENTIFIER) {
      throw new ParserError.ExpectedFormError(
        this.source,
        identifier.pos,
        identifier,
        "<identifier>"
      );
    }
    const convertedIdentifier = new Atomic.Identifier(
      this.toLocation(identifier),
      identifier.lexeme
    );
    const convertedExpr = this.parseExpression(expr);
    return new Atomic.Reassignment(
      group.location,
      convertedIdentifier,
      convertedExpr
    );
  }

  /**
   * Parse a begin expression.
   * @param group
   * @returns
   */
  private parseBegin(group: Group): Extended.Begin {
    // Form: (begin <body>+)
    // ensure that the group has 2 or more elements
    if (group.length() < 2) {
      throw new ParserError.ExpectedFormError(
        this.source,
        group.location.start,
        group,
        "(begin <body>+)"
      );
    }
    const sequence = group.unwrap();
    const sequenceElements = sequence.slice(1);
    const convertedExpressions: Expression[] = [];
    for (const sequenceElement of sequenceElements) {
      convertedExpressions.push(this.parseExpression(sequenceElement));
    }
    return new Extended.Begin(group.location, convertedExpressions);
  }

  /**
   * Parse a delay expression.
   * @param group
   * @returns
   */
  private parseDelay(group: Group): Extended.Delay {
    // Form: (delay <expr>)
    // ensure that the group has 2 elements
    if (group.length() !== 2) {
      throw new ParserError.ExpectedFormError(
        this.source,
        group.location.start,
        group,
        "(delay <expr>)"
      );
    }
    const elements = group.unwrap();
    const expr = elements[1];

    // Expr is treated as a single expression
    const convertedExpr = this.parseExpression(expr);

    return new Extended.Delay(group.location, convertedExpr);
  }

  // ___________________MISCELLANEOUS___________________

  /**
   * Parse an import expression.
   * @param group
   * @param is_js determines whether the import is a JS import or not.
   *              default is false.
   * @returns
   */
  private parseImport(group: Group, is_js: boolean = false): Atomic.Import {
    // Form: (import "<source>" (<identifier>*))
    //     | (js-import "<source>" (<identifier>*))
    // ensure that the group has 3 elements
    if (group.length() !== 3) {
      const im_str = is_js ? "js-import" : "import";
      throw new ParserError.ExpectedFormError(
        this.source,
        group.firstToken().pos,
        group.firstToken(),
        `(${im_str} "<source>" (<identifier>*))`
      );
    }
    const elements = group.unwrap();
    const source = elements[1];
    const identifiers = elements[2];

    // source is treated as a single string
    if (!isToken(source)) {
      throw new ParserError.ExpectedFormError(
        this.source,
        source.location.start,
        source,
        '"<source>"'
      );
    }
    if (source.type !== TokenType.STRING) {
      throw new ParserError.ExpectedFormError(
        this.source,
        source.pos,
        source,
        '"<source>"'
      );
    }

    // Identifiers are treated as a group of identifiers
    if (!isGroup(identifiers)) {
      throw new ParserError.ExpectedFormError(
        this.source,
        identifiers.pos,
        identifiers,
        "(<identifier>*)"
      );
    }
    const identifierElements = identifiers.unwrap();
    const convertedIdentifiers: Atomic.Identifier[] = [];
    for (const identifierElement of identifierElements) {
      if (!isToken(identifierElement)) {
        throw new ParserError.ExpectedFormError(
          this.source,
          identifierElement.location.start,
          identifierElement,
          "<identifier>"
        );
      }
      if (identifierElement.type !== TokenType.IDENTIFIER) {
        throw new ParserError.ExpectedFormError(
          this.source,
          identifierElement.pos,
          identifierElement,
          "<identifier>"
        );
      }
      convertedIdentifiers.push(
        new Atomic.Identifier(
          this.toLocation(identifierElement),
          identifierElement.lexeme
        )
      );
    }
    const convertedSource = new Atomic.StringLiteral(
      this.toLocation(source),
      source.literal
    );
    return new Atomic.Import(
      group.location,
      convertedSource,
      convertedIdentifiers,
      is_js
    );
  }

  /**
   * Parse an export expression.
   * @param group
   * @param is_js determines whether the export is a JS export or not.
   *              default is false.
   * @returns
   */
  private parseExport(group: Group, is_js: boolean = false): Atomic.Export {
    // Form: (export (<definition>))
    //     | (js-export (<definition>))
    // ensure that the group has 2 elements
    if (group.length() !== 2) {
      const ex_str = is_js ? "js-export" : "export";
      throw new ParserError.ExpectedFormError(
        this.source,
        group.firstToken().pos,
        group.firstToken(),
        `(${ex_str} (<definition>))`
      );
    }
    const elements = group.unwrap();
    const definition = elements[1];

    // assert that definition is a group
    if (!isGroup(definition)) {
      throw new ParserError.ExpectedFormError(
        this.source,
        definition.pos,
        definition,
        "(<definition>)"
      );
    }

    const convertedDefinition = this.parseExpression(definition);
    // assert that convertedDefinition is a definition
    if (
      !(
        convertedDefinition instanceof Atomic.Definition ||
        convertedDefinition instanceof Extended.FunctionDefinition
      )
    ) {
      throw new ParserError.ExpectedFormError(
        this.source,
        definition.location.start,
        definition,
        "(<definition>)"
      );
    }

    return new Atomic.Export(group.location, convertedDefinition, is_js);
  }

  /**
   * Parses a vector expression
   */
  private parseVector(group: Group): Atomic.Vector {
    // Because of the group invariants, we can safely assume that the group
    // is strictly of size 2.
    // Additionally, we can safely assume that the second element is a group
    // because token HASH_VECTOR expects a parenthesis as the next immediate
    // token.
    const elements = group.unwrap()[1] as Group;

    // Vectors will be treated normally regardless of the quote mode.
    // but interior expressions will be affected by the mode.
    const convertedElements = elements
      .unwrap()
      .map(this.parseExpression.bind(this)) as Expression[];

    return new Atomic.Vector(group.location, convertedElements);
  }

  // ___________________________________________________

  /** Parses a sequence of tokens into an AST.
   *
   * @param group A group of tokens.
   * @returns An AST.
   */
  parse(): Expression[] {
    // collect all top-level elements
    const topElements: Expression[] = [];
    while (!this.isAtEnd()) {
      if (this.peek().type === TokenType.EOF) {
        break;
      }
      const currentElement = this.grouping();
      if (!currentElement) {
        continue;
      }
      const convertedElement = this.parseExpression(currentElement);
      topElements.push(convertedElement);
    }
    return topElements;
  }
}
