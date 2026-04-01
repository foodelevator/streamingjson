import { describe, test, expect } from "bun:test";
import { parseJson, JsonParsingError } from "./index";

function expectMatch(input: string) {
    let ours: { value: unknown } | { error: unknown };
    let theirs: { value: unknown } | { error: unknown };

    try {
        ours = { value: parseJson(input) };
    } catch (e) {
        ours = { error: e };
    }

    try {
        theirs = { value: JSON.parse(input) };
    } catch (e) {
        theirs = { error: e };
    }

    if ("error" in ours && "error" in theirs) return; // both threw, OK
    if ("error" in ours) throw new Error(`parseJson threw but JSON.parse returned ${JSON.stringify((theirs as any).value)}`);
    if ("error" in theirs) throw new Error(`JSON.parse threw but parseJson returned ${JSON.stringify((ours as any).value)}`);

    expect(ours.value).toEqual(theirs.value);
}

describe("null", () => {
    test("null", () => expectMatch("null"));
    test("nul is invalid", () => expectMatch("nul"));
    test("nullable is invalid", () => expectMatch("nullable"));
    test("Null is invalid", () => expectMatch("Null"));
    test("NULL is invalid", () => expectMatch("NULL"));
});

describe("true", () => {
    test("true", () => expectMatch("true"));
    test("tru is invalid", () => expectMatch("tru"));
    test("True is invalid", () => expectMatch("True"));
    test("TRUE is invalid", () => expectMatch("TRUE"));
    test("truefalse is invalid", () => expectMatch("truefalse"));
});

describe("false", () => {
    test("false", () => expectMatch("false"));
    test("fals is invalid", () => expectMatch("fals"));
    test("False is invalid", () => expectMatch("False"));
    test("FALSE is invalid", () => expectMatch("FALSE"));
});

describe("numbers", () => {
    // integers
    test("0", () => expectMatch("0"));
    test("1", () => expectMatch("1"));
    test("42", () => expectMatch("42"));
    test("123456789", () => expectMatch("123456789"));

    // negative
    test("-0", () => expectMatch("-0"));
    test("-1", () => expectMatch("-1"));
    test("-42", () => expectMatch("-42"));

    // decimals
    test("0.0", () => expectMatch("0.0"));
    test("0.5", () => expectMatch("0.5"));
    test("3.14", () => expectMatch("3.14"));
    test("-3.14", () => expectMatch("-3.14"));
    test("100.001", () => expectMatch("100.001"));

    // exponents
    test("1e2", () => expectMatch("1e2"));
    test("1E2", () => expectMatch("1E2"));
    test("1e+2", () => expectMatch("1e+2"));
    test("1e-2", () => expectMatch("1e-2"));
    test("1E-2", () => expectMatch("1E-2"));
    test("-1e2", () => expectMatch("-1e2"));
    test("2.5e10", () => expectMatch("2.5e10"));
    test("2.5E+10", () => expectMatch("2.5E+10"));
    test("1e0", () => expectMatch("1e0"));
    test("0e0", () => expectMatch("0e0"));

    // large / small
    test("1e20", () => expectMatch("1e20"));
    test("1e-20", () => expectMatch("1e-20"));
    test("9999999999999999", () => expectMatch("9999999999999999"));

    // invalid numbers
    test("bare minus is invalid", () => expectMatch("-"));
    test("plus prefix is invalid", () => expectMatch("+1"));
    test("trailing dot is invalid", () => expectMatch("1."));
    test("leading dot is invalid", () => expectMatch(".5"));
    test("double minus is invalid", () => expectMatch("--1"));
    test("e alone is invalid", () => expectMatch("1e"));
    test("e+ alone is invalid", () => expectMatch("1e+"));
    test("e- alone is invalid", () => expectMatch("1e-"));
    test("hex literal is invalid", () => expectMatch("0x1A"));
    test("NaN is invalid", () => expectMatch("NaN"));
    test("Infinity is invalid", () => expectMatch("Infinity"));
    test("-Infinity is invalid", () => expectMatch("-Infinity"));
});

describe("strings", () => {
    // basic
    test("empty string", () => expectMatch('""'));
    test("simple string", () => expectMatch('"hello"'));
    test("string with spaces", () => expectMatch('"hello world"'));
    test("digits in string", () => expectMatch('"12345"'));
    test("mixed content", () => expectMatch('"abc123!@#"'));

    // escape sequences
    test("escaped quote", () => expectMatch('"he said \\"hi\\""'));
    test("escaped backslash", () => expectMatch('"back\\\\slash"'));
    test("escaped forward slash", () => expectMatch('"a\\/b"'));
    test("escaped backspace", () => expectMatch('"a\\bc"'));
    test("escaped form feed", () => expectMatch('"a\\fc"'));
    test("escaped newline", () => expectMatch('"a\\nc"'));
    test("escaped carriage return", () => expectMatch('"a\\rc"'));
    test("escaped tab", () => expectMatch('"a\\tc"'));
    test("multiple escapes", () => expectMatch('"\\n\\t\\r\\\\"'));

    // unicode escapes
    test("unicode basic latin", () => expectMatch('"\\u0041"')); // A
    test("unicode euro sign", () => expectMatch('"\\u20AC"')); // €
    test("unicode null char", () => expectMatch('"\\u0000"'));
    test("unicode lowercase hex", () => expectMatch('"\\u00e9"')); // é
    test("unicode uppercase hex", () => expectMatch('"\\u00E9"')); // é
    test("unicode mixed case hex", () => expectMatch('"\\u00aB"'));
    test("surrogate pair (emoji)", () => expectMatch('"\\uD83D\\uDE00"')); // 😀

    // strings with embedded values
    test("string looks like number", () => expectMatch('"123"'));
    test("string looks like bool", () => expectMatch('"true"'));
    test("string looks like null", () => expectMatch('"null"'));
    test("string looks like array", () => expectMatch('"[1,2]"'));
    test("string looks like object", () => expectMatch('"{}"'));

    // invalid strings
    test("unterminated string", () => expectMatch('"hello'));
    test("single quotes invalid", () => expectMatch("'hello'"));
    test("bad escape", () => expectMatch('"\\x41"'));
    test("bad escape \\a", () => expectMatch('"\\a"'));

    test("lone high surrogate", () => expectMatch('"\\uD800"'));
    test("lone low surrogate", () => expectMatch('"\\uDC00"'));
    test("high surrogate not followed by low", () => expectMatch('"\\uD800\\u0041"'));
    test("incomplete unicode escape", () => expectMatch('"\\u00"'));
    test("invalid hex in unicode", () => expectMatch('"\\uGGGG"'));
});

describe("arrays", () => {
    test("empty array", () => expectMatch("[]"));
    test("single element", () => expectMatch("[1]"));
    test("multiple numbers", () => expectMatch("[1,2,3]"));
    test("nested array", () => expectMatch("[[1,2],[3,4]]"));
    test("deeply nested", () => expectMatch("[[[1]]]"));
    test("mixed types", () => expectMatch('[1,"two",true,null,false]'));
    test("array of strings", () => expectMatch('["a","b","c"]'));
    test("array of booleans", () => expectMatch("[true,false,true]"));
    test("array of nulls", () => expectMatch("[null,null]"));
    test("array with negative numbers", () => expectMatch("[-1,-2.5,3e-1]"));
    test("array with nested objects", () => expectMatch('[{"a":1},{"b":2}]'));
    test("array with nested arrays and objects", () => expectMatch('[[{"a":[1,2]},3],4]'));
    test("array with empty array", () => expectMatch("[[]]"));
    test("array with empty object", () => expectMatch("[{}]"));
    test("array with empty string", () => expectMatch('[""]'));

    // invalid arrays
    test("missing closing bracket", () => expectMatch("[1,2"));
    test("trailing comma", () => expectMatch("[1,2,]"));
    test("leading comma", () => expectMatch("[,1]"));
    test("double comma", () => expectMatch("[1,,2]"));
    test("just a comma inside", () => expectMatch("[,]"));
    test("missing value after comma", () => expectMatch("[1,]"));
});

describe("objects", () => {
    test("empty object", () => expectMatch("{}"));
    test("single key-value", () => expectMatch('{"a":1}'));
    test("multiple keys", () => expectMatch('{"a":1,"b":2,"c":3}'));
    test("string value", () => expectMatch('{"key":"value"}'));
    test("boolean values", () => expectMatch('{"t":true,"f":false}'));
    test("null value", () => expectMatch('{"n":null}'));
    test("nested object", () => expectMatch('{"a":{"b":{"c":1}}}'));
    test("object with array value", () => expectMatch('{"a":[1,2,3]}'));
    test("object with mixed values", () => expectMatch('{"a":1,"b":"two","c":true,"d":null,"e":[1],"f":{}}'));
    test("numeric string keys", () => expectMatch('{"0":0,"1":1}'));
    test("escaped key", () => expectMatch('{"a\\nb":1}'));
    test("empty string key", () => expectMatch('{"":1}'));
    test("unicode key", () => expectMatch('{"\\u00e9":1}'));
    test("duplicate keys (last wins)", () => expectMatch('{"a":1,"a":2}'));

    // invalid objects
    test("missing closing brace", () => expectMatch('{"a":1'));
    test("trailing comma", () => expectMatch('{"a":1,}'));
    test("missing value", () => expectMatch('{"a":}'));
    test("missing colon", () => expectMatch('{"a"1}'));
    test("non-string key", () => expectMatch("{1:2}"));
    test("single key no value", () => expectMatch('{"a"}'));
    test("bare key", () => expectMatch("{a:1}"));
    test("leading comma", () => expectMatch('{,"a":1}'));
});

describe("edge cases", () => {
    // empty / invalid input
    test("empty string is invalid", () => expectMatch(""));
    test("undefined char is invalid", () => expectMatch("u"));
    test("random text is invalid", () => expectMatch("abc"));
    test("just a colon", () => expectMatch(":"));
    test("just a comma", () => expectMatch(","));
    test("just a bracket open", () => expectMatch("["));
    test("just a brace open", () => expectMatch("{"));
    test("just a bracket close", () => expectMatch("]"));
    test("just a brace close", () => expectMatch("}"));

    // top-level primitives
    test("top-level string", () => expectMatch('"hello"'));
    test("top-level number", () => expectMatch("42"));
    test("top-level negative number", () => expectMatch("-3.14e+2"));
    test("top-level true", () => expectMatch("true"));
    test("top-level false", () => expectMatch("false"));
    test("top-level null", () => expectMatch("null"));

    // complex nesting
    test("complex nested structure", () =>
        expectMatch('{"users":[{"name":"Alice","scores":[100,95.5],"active":true},{"name":"Bob","scores":[],"active":false}],"count":2}'));

    test("deeply nested arrays", () =>
        expectMatch("[[[[[[1]]]]]]"));

    test("deeply nested objects", () =>
        expectMatch('{"a":{"b":{"c":{"d":{"e":1}}}}}'));

    test("array of empty objects", () =>
        expectMatch("[{},{},{}]"));

    test("object with array of objects", () =>
        expectMatch('{"data":[{"id":1,"tags":["a","b"]},{"id":2,"tags":[]}]}'));
});

describe("__proto__ key", () => {
    test("__proto__ key is excluded from result", () => expectMatch('{"__proto__":"bad","a":1}'));
    test("__proto__ as the only key", () => expectMatch('{"__proto__":"bad"}'));
    test("__proto__ with nested object value", () => expectMatch('{"__proto__":{"polluted":true},"safe":1}'));
    test("__proto__ with array value", () => expectMatch('{"__proto__":[1,2,3],"a":"ok"}'));
    test("nested object with __proto__", () => expectMatch('{"a":{"__proto__":"bad","b":1}}'));
    test("__proto__ key doesn't cause prototype pollution", () => {
        const result = parseJson('{"__proto__":{"hacked":true}}');
        expect(Object.hasOwnProperty.call(result, "__proto__")).toBe(true);
        expect(Object.getPrototypeOf(result).hacked).not.toBe(true);
    });
});

describe("leading zeros on numbers", () => {
    test("01 is invalid", () => expectMatch("01"));
    test("007 is invalid", () => expectMatch("007"));
    test("00 is invalid", () => expectMatch("00"));
    test("00.5 is invalid", () => expectMatch("00.5"));
    test("-01 is invalid", () => expectMatch("-01"));
    test("-007 is invalid", () => expectMatch("-007"));
});

describe("raw control characters in strings", () => {
    test("raw newline in string", () => expectMatch('"\n"'));
    test("raw tab in string", () => expectMatch('"\t"'));
    test("raw carriage return in string", () => expectMatch('"\r"'));
    test("raw null byte in string", () => expectMatch('"\0"'));
    test("raw backspace in string", () => expectMatch('"\b"'));
    test("raw form feed in string", () => expectMatch('"\f"'));
    test("raw U+001F in string", () => expectMatch('"\x1F"'));
});

describe("JsonParsingError identity", () => {
    test("throws JsonParsingError for invalid input", () => {
        expect(() => parseJson("")).toThrow(JsonParsingError);
    });

    test("throws JsonParsingError for trailing content", () => {
        expect(() => parseJson("truetrue")).toThrow(JsonParsingError);
    });

    test("throws JsonParsingError for unterminated string", () => {
        expect(() => parseJson('"hello')).toThrow(JsonParsingError);
    });

    test("throws JsonParsingError for invalid number", () => {
        expect(() => parseJson("1e")).toThrow(JsonParsingError);
    });

    test("throws JsonParsingError for missing closing bracket", () => {
        expect(() => parseJson("[1,2")).toThrow(JsonParsingError);
    });

    test("throws JsonParsingError for missing closing brace", () => {
        expect(() => parseJson('{"a":1')).toThrow(JsonParsingError);
    });
});

describe("trailing content after valid value", () => {
    test("number followed by number", () => expectMatch("1 2"));
    test("null followed by null", () => expectMatch("nullnull"));
    test("array followed by object", () => expectMatch("[]{}"));
    test("string followed by string", () => expectMatch('"a""b"'));
    test("number followed by letters", () => expectMatch("123abc"));
    test("false followed by true", () => expectMatch("falsetrue"));
    test("object followed by array", () => expectMatch("{}[]"));
});

describe("raw unicode in strings", () => {
    test("accented characters", () => expectMatch('"café"'));
    test("CJK characters", () => expectMatch('"日本語"'));
    test("raw emoji", () => expectMatch('"hello 😀"'));
    test("mixed scripts", () => expectMatch('"hello мир 世界"'));
    test("arabic text", () => expectMatch('"مرحبا"'));
    test("mathematical symbols", () => expectMatch('"∑∏∫"'));
    test("combining characters", () => expectMatch('"e\u0301"'));
});

describe("whitespace", () => {
    test("leading spaces", () => expectMatch("  42"));
    test("trailing spaces", () => expectMatch("42  "));
    test("leading and trailing spaces", () => expectMatch("  42  "));
    test("leading newline", () => expectMatch("\n42"));
    test("trailing newline", () => expectMatch("42\n"));
    test("leading tab", () => expectMatch("\t42"));
    test("trailing tab", () => expectMatch("42\t"));
    test("carriage return", () => expectMatch("\r\n42\r\n"));
    test("mixed whitespace", () => expectMatch(" \t\n\r 42 \t\n\r "));
    test("spaces in array", () => expectMatch("[ 1 , 2 , 3 ]"));
    test("newlines in array", () => expectMatch("[\n1,\n2,\n3\n]"));
    test("spaces in object", () => expectMatch('{ "a" : 1 , "b" : 2 }'));
    test("newlines in object", () => expectMatch('{\n"a"\n:\n1\n,\n"b"\n:\n2\n}'));
    test("tabs in object", () => expectMatch('{\t"a"\t:\t1\t}'));
    test("deeply nested with whitespace", () => expectMatch('{ "a" : [ 1 , { "b" : 2 } ] }'));
    test("empty array with spaces", () => expectMatch("[  ]"));
    test("empty object with spaces", () => expectMatch("{  }"));
    test("only whitespace is invalid", () => expectMatch("   "));
    test("whitespace around null", () => expectMatch("  null  "));
    test("whitespace around true", () => expectMatch("  true  "));
    test("whitespace around false", () => expectMatch("  false  "));
    test("whitespace around string", () => expectMatch('  "hello"  '));
    test("complex with whitespace", () => expectMatch(`
        {
            "users": [
                { "name": "Alice", "age": 30 },
                { "name": "Bob", "age": 25 }
            ],
            "count": 2
        }
    `));
});

describe("number edge cases", () => {
    test("negative zero equals zero", () => {
        const result = parseJson("-0");
        expect(Object.is(result, -0)).toBe(true);
    });

    test("very large exponent (1e999)", () => expectMatch("1e999"));
    test("very negative exponent (1e-999)", () => expectMatch("1e-999"));
    test("-1e999", () => expectMatch("-1e999"));

    test("max safe integer", () => expectMatch("9007199254740991"));
    test("beyond max safe integer", () => expectMatch("9007199254740992"));
    test("min safe integer", () => expectMatch("-9007199254740991"));

    test("very long integer", () => expectMatch("12345678901234567890"));
    test("many decimal places", () => expectMatch("3.141592653589793238"));
});
