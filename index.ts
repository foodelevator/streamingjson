/**
 * - Never yield anything that is then modified
 */

export class JsonParsingError extends Error {
}

export function* parseJson(s: Iterable<string>): Generator<unknown, unknown> {
    let inp = input(s);
    for (const _ of skipWs(inp, () => undefined));
    const value = yield* parse(inp);
    yield* skipWs(inp, () => value);
    if (!inp("peek").eof) throw new JsonParsingError();
    return value;
}

function* gmap<A, B, R>(g: Generator<A, R>, f: (a: A) => B): Generator<B, R> {
    let next = g.next();
    while (!next.done) {
        yield f(next.value);
        next = g.next();
    }
    return next.value;
}

type Input = (mode: "peek" | "eat") => { char: string; yield: boolean; eof: boolean };

/**
 * Returns a function which when called repeatedly returns succesive characters from {@link raw}. Its return values' fields are:
 * - char: The current character. Is the empty string when `eof` is true.
 * - yield: Is `true` iff this is the last character in a chunk produced by {@link raw}.
 * - eof: Is `true` when {@link raw} is out of characters.
 */
export function input(raw: Iterable<string>): Input {
    const iterator = raw[Symbol.iterator]();
    let chunk = "";
    let index = 0;

    return (mode) => {
        while (index >= chunk.length) {
            const next = iterator.next();
            if (next.done) return { char: "", yield: true, eof: true };
            chunk = next.value;
            index = 0;
        }
        const char = chunk[index]!;
        const isLast = index === chunk.length - 1;
        if (mode === "eat") index += 1;
        return { char, yield: isLast, eof: false };
    };
}

// TODO: add what to yield when encountering .yield == true
function* skipWs<T>(inp: Input, toYield: () => T): Generator<T, void> {
    while (true) {
        const r = inp("peek");
        if (![" ", "\t", "\n", "\r"].includes(r.char)) break;
        inp("eat");
        if (r.yield) yield toYield();
    }
}

function parse(inp: Input): Generator<unknown, unknown> {
    const r = inp("peek");
    switch (r.char) {
        case "n":
            return parseLiteral(inp, "null", null);
        case "t":
            return parseLiteral(inp, "true", true);
        case "f":
            return parseLiteral(inp, "false", false);
        case "[":
            return parseArray(inp);
        case '"':
            return parseString(inp);
        case '{':
            return parseObject(inp);
        default:
            if ("0" <= r.char && r.char <= "9" || r.char == "-")
                return parseNumber(inp);
    }
    throw new JsonParsingError();
}

function* parseLiteral<T>(inp: Input, literal: string, value: T): Generator<T, T> {
    for (let i = 0; i < literal.length; i++) {
        const r = inp("eat");
        if (r.char !== literal[i]) throw new JsonParsingError();
        if (r.yield) yield value;
    }
    return value;
}

function* parseArray(inp: Input): Generator<unknown[], unknown[]> {
    let r = inp("eat");
    if (r.char !== "[") throw new JsonParsingError();
    if (r.yield) yield [];

    let result: unknown[] = [];
    yield* skipWs(inp, () => []);
    r = inp("peek");
    if (r.char === "]") {
        inp("eat");
        if (r.yield) yield [];
        return result;
    }

    while (true) {
        const element = yield* gmap(parse(inp), el => [...result, el]);
        result = [...result, element];
        yield* skipWs(inp, () => result);

        const r = inp("peek");
        if (r.char === "]") {
            inp("eat");
            if (r.yield) yield result;
            return result;
        }
        if (r.char !== ",") throw new JsonParsingError();
        if (inp("eat").yield) yield result;
        yield* skipWs(inp, () => result);
    }
}

function hexDigit(c: string): number {
    if ("0" <= c && c <= "9") return c.charCodeAt(0) - 48;
    if ("a" <= c && c <= "f") return c.charCodeAt(0) - 87;
    if ("A" <= c && c <= "F") return c.charCodeAt(0) - 55;
    throw new JsonParsingError();
}

function* parseHex4(inp: Input): Generator<void, number> {
    let result = 0;
    for (let i = 0; i < 4; i++) {
        const r = inp("eat");
        if (r.yield) yield;
        result = (result << 4) | hexDigit(r.char);
    }
    return result;
}

const basicEscapes: Record<string, string> = {
    '"': '"',
    "\\": "\\",
    "/": "/",
    "b": "\b",
    "f": "\f",
    "n": "\n",
    "r": "\r",
    "t": "\t",
};

/**
 * Expects the initial `\` to have been eaten already
 */
function* parseEscape(inp: Input): Generator<void, string> {
    let r = inp("eat");
    if (r.char in basicEscapes) {
        if (r.yield) yield;
        return basicEscapes[r.char]!;
    }
    if (r.char !== "u") throw new JsonParsingError();

    // WTF-16 is stupid
    const hex = yield* parseHex4(inp);
    if (!(0xD800 <= hex && hex < 0xDC00)) return String.fromCharCode(hex);
    // High surrogate — check for low surrogate pair
    r = inp("peek");
    if (r.yield) yield;
    if (r.char !== "\\") return String.fromCharCode(hex);
    inp("eat"); // '\'
    r = inp("peek");
    if (r.yield) yield;
    if (r.char !== "u") {
        // Consumed '\' but next isn't 'u' — emit high surrogate, then handle escape
        const next = yield* parseEscape(inp);
        return String.fromCharCode(hex) + next;
    }
    inp("eat"); // 'u'
    const low = yield* parseHex4(inp);
    if (0xDC00 <= low && low < 0xE000)
        return String.fromCodePoint(0x10000 + ((hex - 0xD800) << 10) + (low - 0xDC00));
    // Not a valid low surrogate — emit both
    return String.fromCharCode(hex) + String.fromCharCode(low);
}

function* parseString(inp: Input): Generator<string, string> {
    let r = inp("eat");
    if (r.char !== '"') throw new JsonParsingError();
    if (r.yield) yield "";

    let result = "";
    while (true) {
        r = inp("eat");
        if (r.char === '"') {
            if (r.yield) yield result;
            return result;
        } else if (r.char === "\\") {
            if (r.yield) yield result;
            const esc = yield* gmap(parseEscape(inp), () => result);
            result += esc;
        } else if (r.char.charCodeAt(0) < 0x20) {
            // Must be escaped to be valid in a string literal.
            throw new JsonParsingError();
        } else if (r.eof) {
            throw new JsonParsingError();
        } else {
            result += r.char;
            if (r.yield) yield result;
        }
    }
}

function* parseObject(inp: Input): Generator<Record<string, unknown>, Record<string, unknown>> {
    let r = inp("eat");
    if (r.char !== "{") throw new JsonParsingError();
    if (r.yield) yield {};

    let object: Record<string, unknown> = {};
    yield* skipWs(inp, () => object);
    r = inp("peek");
    if (r.char === "}") {
        inp("eat");
        if (r.yield) yield object;
        return object;
    }

    while (true) {
        const key = yield* gmap(parseString(inp), _ => object);
        yield* skipWs(inp, () => object);

        if (inp("eat").char !== ":") throw new JsonParsingError();
        // NOTE: if we here reach a yield point, would it make sense to yield with the value set to
        // undefined?
        yield* skipWs(inp, () => object);

        const value = yield* gmap(
            parse(inp),
            value => Object.defineProperty(
                { ...object },
                key,
                { value, writable: true, enumerable: true, configurable: true },
            ),
        );
        yield* skipWs(inp, () => object);

        object = Object.defineProperty(
            { ...object },
            key,
            { value, writable: true, enumerable: true, configurable: true },
        );

        const r = inp("peek");
        if (r.char === "}") {
            inp("eat");
            if (r.yield) yield object;
            return object;
        }
        if (r.char !== ",") throw new JsonParsingError();
        if (inp("eat").yield) yield object;
        yield* skipWs(inp, () => object);
    }
}

function* parseNumber(inp: Input): Generator<number, number> {
    let numStr = "";

    if (inp("peek").char === "-") {
        numStr += "-";
        if (inp("eat").yield) yield 0;
    }

    let foundDigit = false;
    while (true) {
        const r = inp("peek");
        if (r.char < "0" || r.char > "9") break;
        numStr += r.char;
        if (r.yield) yield Number(numStr);
        inp("eat");
        foundDigit = true;
    }
    if (!foundDigit) throw new JsonParsingError();

    // Disallow leading zeros for non-zero numbers
    const intStart = numStr[0] === "-" ? 1 : 0;
    if (numStr.length - intStart > 1 && numStr[intStart] === "0") throw new JsonParsingError();

    let r = inp("peek");
    if (r.char === ".") {
        if (r.yield) yield Number(numStr);
        numStr += ".";
        inp("eat");

        let foundDigit = false;
        while (true) {
            const r = inp("peek");
            if (r.char < "0" || r.char > "9") break;
            numStr += r.char;
            if (r.yield) yield Number(numStr);
            inp("eat");
            foundDigit = true;
        }
        if (!foundDigit) throw new JsonParsingError();
    }

    r = inp("peek");
    if (["e", "E"].includes(r.char)) {
        if (r.yield) yield Number(numStr);
        const numWithoutExp = numStr;
        numStr += r.char;
        inp("eat");

        r = inp("peek");
        if (["-", "+"].includes(r.char)) {
            if (r.yield) yield Number(numWithoutExp);
            numStr += r.char;
            inp("eat");
        }

        let foundDigit = false;
        while (true) {
            r = inp("peek");
            if (r.char < "0" || r.char > "9") break;
            numStr += r.char;
            if (r.yield) yield Number(numStr);
            inp("eat");
            foundDigit = true;
        }
        if (!foundDigit) throw new JsonParsingError();
    }

    return Number(numStr);
}
