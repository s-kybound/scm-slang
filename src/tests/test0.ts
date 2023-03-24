import { Tokenizer } from "../tokenizer";
import { SchemeParser } from "../scheme-parser"; 
const escodegen = require("escodegen");

const str = " ( 1. 11. . .. ... . .1 .a .h .\n .1\n .a\n"

const tz = new Tokenizer(str);

const tok = tz.scanTokens();

console.log(tok);