/**
 * Given an array of s-expressions, it converts them into the AST of the Scheme program.
 * Essentially, this converts the cons-cell representation into a more concise AST.
 */
import { Atomic, Expression } from '../../types/node-types';

export class SExprToSchemeAstParser {
    private readonly sExpr: Expression[];
    private ast: Expression[];
    constructor(sExpr: Expression[]) {
        this.sExpr = sExpr;
    }

    /**
     * Parses a single s-expression into the required AST.
     * @param expr 
     * @returns 
     */
    parseSExpr(expr: Expression) : Expression {
        // There are only several types of s-expressions that we need to handle.
        // 1. Literals (numbers, strings, booleans)
        // 2. Symbols
        // 3. Identifier
        // 4. Pair (most likely a list)
        // 5. Nil
        if (expr instanceof Atomic.NumericLiteral || expr instanceof Atomic.StringLiteral || expr instanceof Atomic.BooleanLiteral) {
            return expr;
        }
        if (expr instanceof Atomic.Symbol) {
            return expr;
        }
        if (expr instanceof Atomic.Identifier) {
            return expr;
        }
        if (expr instanceof Atomic.Pair) {
            // Ascertain if we are supposed to evaluate this expression.
            if (expr.eval) {
                return this.evalList(expr);
            }
            return expr;
        }
        if (expr instanceof Atomic.Nil) {
            // Ascertain if we are supposed to evaluate this expression.
            if (expr.eval) {
                throw new Error('Unexpected nil');
            }
            return expr;
        }
    }

    /**
     * Evaluates a list of expressions.
     * @param expr 
     * @returns 
     * 
     * TODO: Current parser works only on a subset of the Scheme language.
     *       Extension of its capabilities will be required soon. 
     */
    evalList(expr: Atomic.Pair): Expression {
        const car = expr.car;
        if (car instanceof Atomic.Identifier) {
            switch (car.name) {
                case 'define':
                    return this.parseDefine(expr);
                case 'lambda':
                    return this.parseLambda(expr);
                case 'if':
                    return this.parseIf(expr);
                case 'set!':
                    return this.parseSet(expr);
                default:
                    return this.parseApplication(expr);
            }
        }
        return this.parseApplication(expr);
    }
    
    parse(): Atomic.Sequence {
        for (const expr of this.sExpr) {
            this.ast.push(this.parseSExpr(expr));
        }
        const newLocation = this.sExpr[0].location.merge(this.sExpr[this.sExpr.length - 1].location);
        return new Atomic.Sequence(newLocation, this.ast);
    }
}