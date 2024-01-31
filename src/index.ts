import { Program } from "estree";
import { encode as b64Encode, decode as b64Decode } from "js-base64";

export * from "./stdlib/prelude-visitor";
export { TokenizerError } from "./parser";
export { ParserError } from "./parser";
export { schemeParse } from "./parser";

const JS_KEYWORDS: string[] = [
    "break",
    "case",
    "catch",
    "class",
    "const",
    "continue",
    "debugger",
    "default",
    "delete",
    "do",
    "else",
    "export",
    "extends",
    "false",
    "finally",
    "for",
    "function",
    "if",
    "import",
    "in",
    "instanceof", "new",
    "return",
    "super",
    "switch",
    "this",
    "throw",
    "true",
    "try",
    "typeof",
    "var",
    "void",
    "while",
    "with",
    "yield",
    "enum",
    "await",
    "implements",
    "package",
    "protected",
    "static",
    "interface",
    "private",
    "public",
];

/**
 * Takes a Scheme identifier and encodes it to follow JS naming conventions.
 *
 * @param identifier An identifier name.
 * @returns An encoded identifier that follows JS naming conventions.
 */
export function encode(identifier: string): string {
    if (JS_KEYWORDS.includes(identifier) || identifier.startsWith("$scheme_")) {
        return (
            "$scheme_" +
                b64Encode(identifier).replace(
                    /([^a-zA-Z0-9_])/g,
                    (match: string) => `\$${match.charCodeAt(0)}\$`
                )
        );
    } else {
        return identifier.replace(
            /([^a-zA-Z0-9_])/g,
            (match: string) => `\$${match.charCodeAt(0)}\$`
        );
    }
}

/**
 * Takes a JS identifier and decodes it to follow Scheme naming conventions.
 *
 * @param identifier An encoded identifier name.
 * @returns A decoded identifier that follows Scheme naming conventions.
 */
export function decode(identifier: string): string {
    if (identifier.startsWith("$scheme_")) {
        return b64Decode(
            identifier
                .slice(8)
                .replace(/\$([0-9]+)\$/g, (_, code: string) =>
                    String.fromCharCode(parseInt(code))
                        )
        );
    } else {
        return identifier.replace(/\$([0-9]+)\$/g, (_, code: string) =>
            String.fromCharCode(parseInt(code))
                                 );
    }
}
