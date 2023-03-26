import { readFileSync } from "fs";
import { Tokenizer } from "../tokenizer";
import { SchemeParser } from "../parser"; 
const escodegen = require("escodegen");

const acorn = require("acorn");
const walk = require("acorn-walk");

const glob = readFileSync("./src/scheme-global-environment.js", "utf8");
const tree = acorn.parse(glob, {ecmaVersion: 2020, sourceType: "module"});

let keywords = new Map<string, string>([
    ["plus", "+"],
    ["minus", "-"],
    ["multiply", "*"],
    ["divide", "/"],  
    ["equal", "="],
]);

walk.simple(tree, {
    VariableDeclarator(node: any) {
        if (keywords.has(node.id.name)) {
            node.id.name = keywords.get(node.id.name);
        }
    }
});

const str = readFileSync("./src/tests/factorial.scm", "utf8");

const tz = new Tokenizer(str);

const tok = tz.scanTokens();

const ps = new SchemeParser(tok);

tree.body.push(...ps.parse().body);

console.log(escodegen.generate(tree));