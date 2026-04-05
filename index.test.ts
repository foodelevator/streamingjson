import { describe, test, expect } from "bun:test";
import { parseJson, JsonParsingError, input } from "./index";
import { zStreaming } from "./zod-schema";
import { z } from "zod";
import fc from "fast-check";

/** Drain a generator, collecting every yielded value and the final return. */
async function collectYieldsAndReturn(gen: AsyncGenerator<unknown, unknown>) {
    const yields: unknown[] = [];
    let next;
    for (next = await gen.next(); !next.done; next = await gen.next()) {
        yields.push(next.value);
    }
    return { yields, final: next.value };
}

function parseJsonString(input: string) {
    return parseJson(async function*() { yield input; }());
}

async function expectMatch(input: string) {
    let ours: { value: unknown } | { error: unknown };
    let theirs: { value: unknown } | { error: unknown };



    try {
        ours = { value: (await collectYieldsAndReturn(parseJsonString(input))).final };
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

describe("input wrapper", () => {
    test("basic", async () => {
        async function* rawData() {
            yield "hel";
            yield "lo";
            yield "!";
        }

        const f = input(rawData());
        expect(await f("eat")).toEqual({ char: "h", yield: false, eof: false });
        expect(await f("eat")).toEqual({ char: "e", yield: false, eof: false });
        expect(await f("eat")).toEqual({ char: "l", yield: true, eof: false });
        expect(await f("eat")).toEqual({ char: "l", yield: false, eof: false });
        expect(await f("eat")).toEqual({ char: "o", yield: true, eof: false });
        expect(await f("eat")).toEqual({ char: "!", yield: true, eof: false });
        expect(await f("eat")).toEqual({ char: "", yield: true, eof: true });
        expect(await f("eat")).toEqual({ char: "", yield: true, eof: true });
    });
    test("peeking", async () => {
        async function* rawData() {
            yield "hel";
            yield "lo";
            yield "!";
        }

        const f = input(rawData());
        expect(await f("eat")).toEqual({ char: "h", yield: false, eof: false });
        expect(await f("peek")).toEqual({ char: "e", yield: false, eof: false });
        expect(await f("peek")).toEqual({ char: "e", yield: false, eof: false });
        expect(await f("peek")).toEqual({ char: "e", yield: false, eof: false });
        expect(await f("eat")).toEqual({ char: "e", yield: false, eof: false });
        expect(await f("peek")).toEqual({ char: "l", yield: true, eof: false });
        expect(await f("eat")).toEqual({ char: "l", yield: true, eof: false });
        expect(await f("eat")).toEqual({ char: "l", yield: false, eof: false });
        expect(await f("eat")).toEqual({ char: "o", yield: true, eof: false });
        expect(await f("peek")).toEqual({ char: "!", yield: true, eof: false });
        expect(await f("peek")).toEqual({ char: "!", yield: true, eof: false });
        expect(await f("peek")).toEqual({ char: "!", yield: true, eof: false });
        expect(await f("eat")).toEqual({ char: "!", yield: true, eof: false });
        expect(await f("peek")).toEqual({ char: "", yield: true, eof: true });
        expect(await f("eat")).toEqual({ char: "", yield: true, eof: true });
        expect(await f("eat")).toEqual({ char: "", yield: true, eof: true });
    });
    test("empty chunks", async () => {
        async function* rawData() {
            yield "";
            yield "";
            yield "hel";
            yield "lo";
            yield "";
            yield "";
            yield "";
            yield "";
            yield "!";
            yield "";
            yield "";
        }

        const f = input(rawData());
        expect(await f("eat")).toEqual({ char: "h", yield: false, eof: false });
        expect(await f("eat")).toEqual({ char: "e", yield: false, eof: false });
        expect(await f("eat")).toEqual({ char: "l", yield: true, eof: false });
        expect(await f("eat")).toEqual({ char: "l", yield: false, eof: false });
        expect(await f("eat")).toEqual({ char: "o", yield: true, eof: false });
        expect(await f("eat")).toEqual({ char: "!", yield: true, eof: false });
        expect(await f("eat")).toEqual({ char: "", yield: true, eof: true });
        expect(await f("eat")).toEqual({ char: "", yield: true, eof: true });
    });
});

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
    test("__proto__ key doesn't cause prototype pollution", async () => {
        const { final } = await collectYieldsAndReturn(parseJson(async function*() { yield '{"__proto__":{"hacked":true}}' }()));
        expect(Object.hasOwnProperty.call(final, "__proto__")).toBe(true);
        expect(Object.getPrototypeOf(final).hacked).not.toBe(true);
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
        expect(async () => (await collectYieldsAndReturn(parseJsonString(""))).final).toThrow(JsonParsingError);
    });

    test("throws JsonParsingError for trailing content", () => {
        expect(async () => (await collectYieldsAndReturn(parseJsonString("truetrue"))).final).toThrow(JsonParsingError);
    });

    test("throws JsonParsingError for unterminated string", () => {
        expect(async () => (await collectYieldsAndReturn(parseJsonString('"hello'))).final).toThrow(JsonParsingError);
    });

    test("throws JsonParsingError for invalid number", () => {
        expect(async () => (await collectYieldsAndReturn(parseJsonString("1e"))).final).toThrow(JsonParsingError);
    });

    test("throws JsonParsingError for missing closing bracket", () => {
        expect(async () => (await collectYieldsAndReturn(parseJsonString("[1,2"))).final).toThrow(JsonParsingError);
    });

    test("throws JsonParsingError for missing closing brace", () => {
        expect(async () => (await collectYieldsAndReturn(parseJsonString('{"a":1'))).final).toThrow(JsonParsingError);
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
    test("negative zero equals zero", async () => {
        const result = (await collectYieldsAndReturn(parseJsonString("-0"))).final;
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

describe("streaming", () => {
    test("some object", async () => {
        const s = '{"name":"Alice","age":34,"active":true,"scores":[95,87,73,100],"address":{"street":"742 Elm St","city":"Portland","zip":"97201"},"tags":["admin","verified"],"lastLogin":"2026-03-15T08:30:00Z"}';
        async function* gen() {
            let i = 0;
            while (i < s.length) {
                const j = Math.min(i + Math.ceil(Math.random() * 10), s.length);
                yield s.slice(i, j);
                i = j;
            }
        };
        expect((await collectYieldsAndReturn(parseJson(gen()))).final).toEqual(JSON.parse(s));
    });
});

/** Produce a generator that yields `s` split at the given cut points. */
async function* chunked(s: string, cuts: number[]): AsyncGenerator<string> {
    const sorted = [...new Set(cuts)].sort((a, b) => a - b).filter(c => c > 0 && c < s.length);
    let prev = 0;
    for (const c of sorted) {
        yield s.slice(prev, c);
        prev = c;
    }
    yield s.slice(prev);
}

/** Arbitrary for an array of cut points within a string of length `len`. */
function cutPointsArb(len: number) {
    if (len <= 1) return fc.constant([] as number[]);
    return fc.array(fc.integer({ min: 1, max: len - 1 }), { minLength: 1, maxLength: Math.min(len, 20) });
}

/**
 * Like chunked(), but also splices in empty strings at random positions.
 */
async function* chunkedWithEmpties(s: string, cuts: number[], emptyPositions: number[]): AsyncGenerator<string> {
    const chunks: string[] = [];
    const sorted = [...new Set(cuts)].sort((a, b) => a - b).filter(c => c > 0 && c < s.length);
    let prev = 0;
    for (const c of sorted) {
        chunks.push(s.slice(prev, c));
        prev = c;
    }
    chunks.push(s.slice(prev));
    // Insert empty strings at specified positions (high to low to keep indices valid)
    for (const pos of [...emptyPositions].sort((a, b) => b - a)) {
        const clamped = Math.min(pos, chunks.length);
        chunks.splice(clamped, 0, "");
    }
    yield* chunks;
}

/** Arbitrary for positions to insert empty chunks. */
function emptyPosArb(maxLen: number) {
    return fc.array(fc.integer({ min: 0, max: maxLen + 5 }), { minLength: 0, maxLength: 5 });
}

/**
 * Return the structural type tag for a JSON value so we can assert
 * type consistency across yields.
 */
function structuralType(v: unknown) {
    if (v === null) return "null";
    if (Array.isArray(v)) return "array";
    return typeof v; // "object" | "string" | "number" | "boolean"
}

describe("property tests", () => {
    test("chunking independence of final value", () => {
        fc.assert(fc.asyncProperty(fc.jsonValue(), cutPointsArb(200), emptyPosArb(20), async (value, cuts, empties) => {
            const s = JSON.stringify(value);
            const realCuts = cuts.filter(c => c < s.length);
            const { final } = await collectYieldsAndReturn(
                parseJson(chunkedWithEmpties(s, realCuts, empties)),
            );
            expect(final).toEqual(JSON.parse(s));
        }));
    });

    test("type consistency of yields", () => {
        fc.assert(fc.asyncProperty(fc.jsonValue(), cutPointsArb(200), async (value, cuts) => {
            const s = JSON.stringify(value);
            const realCuts = cuts.filter(c => c < s.length);
            const { yields, final } = await collectYieldsAndReturn(
                parseJson(chunked(s, realCuts)),
            );
            const expected = structuralType(final);
            for (const y of yields) {
                expect(structuralType(y)).toBe(expected);
            }
        }));
    });

    test("immutability of yields", () => {
        fc.assert(fc.asyncProperty(fc.jsonValue(), cutPointsArb(200), async (value, cuts) => {
            const s = JSON.stringify(value);
            const realCuts = cuts.filter(c => c < s.length);
            const gen = parseJson(chunked(s, realCuts));
            const snapshots: unknown[] = [];
            const originals: unknown[] = [];
            let next;
            for (next = await gen.next(); !next.done; next = await gen.next()) {
                originals.push(next.value);
                snapshots.push(structuredClone(next.value));
            }
            // After generator completes, no yielded value should have been mutated
            for (let i = 0; i < originals.length; i++) {
                expect(originals[i]).toEqual(snapshots[i]);
            }
        }));
    });

    test("monotonic array growth", () => {
        fc.assert(fc.asyncProperty(
            fc.array(fc.jsonValue(), { minLength: 0, maxLength: 10 }),
            cutPointsArb(500),
            async (arr, cuts) => {
                const s = JSON.stringify(arr);
                const realCuts = cuts.filter(c => c < s.length);
                const { yields } = await collectYieldsAndReturn(
                    parseJson(chunked(s, realCuts)),
                );
                for (let i = 1; i < yields.length; i++) {
                    const prev = yields[i - 1] as unknown[];
                    const curr = yields[i] as unknown[];
                    expect(prev).toBeArray();
                    expect(curr).toBeArray();
                    expect(curr.length).toBeGreaterThanOrEqual(prev.length);
                }
            },
        ));
    });

    test("monotonic object key growth", () => {
        fc.assert(fc.asyncProperty(
            fc.dictionary(fc.string(), fc.jsonValue(), { minKeys: 0, maxKeys: 8 }),
            cutPointsArb(500),
            async (obj, cuts) => {
                const s = JSON.stringify(obj);
                const realCuts = cuts.filter(c => c < s.length);
                const { yields } = await collectYieldsAndReturn(
                    parseJson(chunked(s, realCuts)),
                );
                for (let i = 1; i < yields.length; i++) {
                    const prevKeys = Object.keys(yields[i - 1] as Record<string, unknown>);
                    const currKeys = Object.keys(yields[i] as Record<string, unknown>);
                    expect(currKeys.length).toBeGreaterThanOrEqual(prevKeys.length);
                    // All previous keys are still present
                    for (const k of prevKeys) {
                        expect(currKeys).toContain(k);
                    }
                }
            },
        ));
    });

    test("string prefix property", () => {
        fc.assert(fc.asyncProperty(fc.string(), cutPointsArb(500), async (str, cuts) => {
            const s = JSON.stringify(str);
            const realCuts = cuts.filter(c => c < s.length);
            const { yields, final } = await collectYieldsAndReturn(
                parseJson(chunked(s, realCuts)),
            );
            // Each yield is a prefix of the next
            for (let i = 1; i < yields.length; i++) {
                expect(yields[i]).toStartWith(yields[i - 1] as string);
            }
            // Last yield (if any) is a prefix of the final value
            if (yields.length > 0) {
                expect(final).toStartWith(yields[yields.length - 1] as string);
            }
        }));
    });

    test("multi-chunk input produces at least one yield", () => {
        fc.assert(fc.asyncProperty(fc.jsonValue(), async (value) => {
            const s = JSON.stringify(value);
            if (s.length < 2) return; // can't split a 1-char string into 2 non-empty chunks
            // Split at the midpoint to guarantee 2 non-empty chunks
            const mid = Math.floor(s.length / 2);
            const { yields } = await collectYieldsAndReturn(
                parseJson(chunked(s, [mid])),
            );
            expect(yields.length).toBeGreaterThanOrEqual(1);
        }));
    });

    test("yields are JSON-serializable", () => {
        fc.assert(fc.asyncProperty(fc.jsonValue(), cutPointsArb(200), async (value, cuts) => {
            const s = JSON.stringify(value);
            const realCuts = cuts.filter(c => c < s.length);
            const { yields } = await collectYieldsAndReturn(
                parseJson(chunked(s, realCuts)),
            );
            for (const y of yields) {
                if (y === undefined) continue;
                expect(() => JSON.stringify(y)).not.toThrow();
            }
        }));
    });

    test("no undefined yields for JSON.stringify output", () => {
        fc.assert(fc.asyncProperty(fc.jsonValue(), cutPointsArb(200), emptyPosArb(20), async (value, cuts, empties) => {
            const s = JSON.stringify(value);
            const realCuts = cuts.filter(c => c < s.length);
            const { yields } = await collectYieldsAndReturn(
                parseJson(chunkedWithEmpties(s, realCuts, empties)),
            );
            for (const y of yields) {
                expect(y).not.toEqual(undefined);
            }
        }));
    });

    test("whitespace padding does not affect final value", () => {
        const wsChar = fc.constantFrom(" ", "\t", "\n", "\r");
        const wsPadding = fc.array(wsChar, { minLength: 0, maxLength: 10 }).map(chars => chars.join(""));

        fc.assert(fc.asyncProperty(fc.jsonValue(), wsPadding, wsPadding, cutPointsArb(200), async (value, leading, trailing, cuts) => {
            const core = JSON.stringify(value);
            const s = leading + core + trailing;
            const realCuts = cuts.filter(c => c < s.length);
            const { final } = await collectYieldsAndReturn(
                parseJson(chunked(s, realCuts)),
            );
            // Compare against JSON.parse to account for round-trip lossy
            // conversions (e.g., -0 → 0)
            expect(final).toEqual(JSON.parse(core));
        }));
    });

    test("number finiteness", () => {
        fc.assert(fc.asyncProperty(
            fc.double({ noNaN: true, noDefaultInfinity: true }),
            cutPointsArb(50),
            async (num, cuts) => {
                const s = JSON.stringify(num);
                if (s === "null") return; // skip edge cases like JSON.stringify(NaN) → "null"
                const realCuts = cuts.filter(c => c < s.length);
                const { yields } = await collectYieldsAndReturn(
                    parseJson(chunked(s, realCuts)),
                );
                for (const y of yields) {
                    if (typeof y === "number") {
                        expect(Number.isFinite(y)).toBe(true);
                    }
                }
            },
        ));
    });

    test("array completed-elements prefix", () => {
        fc.assert(fc.asyncProperty(
            fc.array(fc.jsonValue(), { minLength: 1, maxLength: 8 }),
            cutPointsArb(500),
            async (arr, cuts) => {
                const s = JSON.stringify(arr);
                const realCuts = cuts.filter(c => c < s.length);
                const { yields, final } = await collectYieldsAndReturn(
                    parseJson(chunked(s, realCuts)),
                );
                const finalArr = final as unknown[];
                for (const y of yields) {
                    const yArr = y as unknown[];
                    if (yArr.length === 0) continue;
                    // All elements except the last must match the final array's prefix
                    const completed = yArr.slice(0, -1);
                    const expectedPrefix = finalArr.slice(0, completed.length);
                    expect(completed).toEqual(expectedPrefix);
                }
            },
        ));
    });

    test("object completed-values prefix", () => {
        // Use alpha-only keys so insertion order is preserved (no integer-like keys)
        const alphaKey = fc.string({ minLength: 1, maxLength: 6 }).filter(s => !/^[0-9]+$/.test(s));
        const objArb = fc.dictionary(alphaKey, fc.jsonValue(), { minKeys: 1, maxKeys: 8 });

        fc.assert(fc.asyncProperty(
            objArb,
            cutPointsArb(500),
            async (obj, cuts) => {
                const s = JSON.stringify(obj);
                const realCuts = cuts.filter(c => c < s.length);
                const { yields, final } = await collectYieldsAndReturn(
                    parseJson(chunked(s, realCuts)),
                );
                const finalObj = final as Record<string, unknown>;
                const finalKeys = Object.keys(finalObj);
                for (const y of yields) {
                    const yObj = y as Record<string, unknown>;
                    const yKeys = Object.keys(yObj);
                    if (yKeys.length === 0) continue;
                    // All key-value pairs except the last must match the final object
                    const completedKeys = yKeys.slice(0, -1);
                    for (const k of completedKeys) {
                        expect(finalKeys).toContain(k);
                        expect(yObj[k]).toEqual(finalObj[k]);
                    }
                }
            },
        ));
    });
});

describe("zStreaming property tests", () => {
    /** JSON-safe number arbitrary. */
    const jsonNumber = fc.integer({ min: -1000000, max: 1000000 });

    const testSchemas: { name: string; schema: z.ZodType; arb: fc.Arbitrary<unknown> }[] = [
        {
            name: "flat object",
            schema: z.object({ name: z.string(), age: z.number(), ok: z.boolean() }),
            arb: fc.record({ name: fc.string(), age: jsonNumber, ok: fc.boolean() }),
        },
        {
            name: "string array",
            schema: z.array(z.string()),
            arb: fc.array(fc.string(), { maxLength: 8 }),
        },
        {
            name: "number array",
            schema: z.array(z.number()),
            arb: fc.array(jsonNumber, { maxLength: 8 }),
        },
        {
            name: "nested object",
            schema: z.object({ meta: z.object({ id: z.number() }), tags: z.array(z.string()) }),
            arb: fc.record({ meta: fc.record({ id: jsonNumber }), tags: fc.array(fc.string(), { maxLength: 5 }) }),
        },
        {
            name: "enum field",
            schema: z.object({ color: z.enum(["r", "g", "b"]) }),
            arb: fc.record({ color: fc.constantFrom("r" as const, "g" as const, "b" as const) }),
        },
        {
            name: "literal string field",
            schema: z.object({ type: z.literal("event") }),
            arb: fc.constant({ type: "event" }),
        },
        {
            name: "literal number field",
            schema: z.object({ code: z.literal(200) }),
            arb: fc.constant({ code: 200 }),
        },
        {
            name: "nullable field",
            schema: z.object({ x: z.nullable(z.string()) }),
            arb: fc.record({ x: fc.option(fc.string(), { nil: null }) }),
        },
        {
            name: "union of objects",
            schema: z.union([z.object({ a: z.string() }), z.object({ b: z.number() })]),
            arb: fc.oneof(
                fc.record({ a: fc.string() }),
                fc.record({ b: jsonNumber }),
            ),
        },
        {
            name: "array of objects with enum",
            schema: z.array(z.object({ label: z.enum(["x", "y"]), n: z.number() })),
            arb: fc.array(
                fc.record({ label: fc.constantFrom("x" as const, "y" as const), n: jsonNumber }),
                { maxLength: 5 },
            ),
        },
        {
            name: "deeply nested object",
            schema: z.object({ a: z.object({ b: z.object({ c: z.string() }) }) }),
            arb: fc.record({ a: fc.record({ b: fc.record({ c: fc.string() }) }) }),
        },
        {
            name: "object with null and boolean",
            schema: z.object({ alive: z.boolean(), data: z.null() }),
            arb: fc.record({ alive: fc.boolean(), data: fc.constant(null) }),
        },
    ];

    for (const { name, schema, arb } of testSchemas) {
        test(`every yield conforms to zStreaming — ${name}`, () => {
            const streaming = zStreaming(schema);
            fc.assert(fc.asyncProperty(arb, cutPointsArb(500), async (value, cuts) => {
                const s = JSON.stringify(value);
                const realCuts = cuts.filter(c => c < s.length);
                const { yields, final } = await collectYieldsAndReturn(
                    parseJson(chunked(s, realCuts)),
                );
                // Final value must conform to the original schema
                expect(schema.safeParse(final).success).toBe(true);
                // Every intermediate yield must conform to the streaming schema
                for (const y of yields) {
                    const result = streaming.safeParse(y);
                    if (!result.success) {
                        throw new Error(
                            `Yield failed zStreaming validation:\n` +
                            `  schema: ${name}\n` +
                            `  json: ${s}\n` +
                            `  cuts: [${realCuts.join(",")}]\n` +
                            `  yield: ${JSON.stringify(y)}\n` +
                            `  error: ${JSON.stringify(result.error.issues)}`
                        );
                    }
                }
            }));
        });
    }
});
