/**
 * - Never yield anything that is then modified
 */

export class JsonParsingError extends Error {
}

export async function* parseJson(s: AsyncIterable<string>): AsyncGenerator<unknown, unknown> {
    let inp = input(s);
    for await (const _ of skipWs(inp, () => undefined));
    const value = yield* parse(inp);
    yield* skipWs(inp, () => value);
    if (!(await inp("peek")).eof) throw new JsonParsingError();
    return value;
}

async function* gmap<A, B, R>(g: AsyncGenerator<A, R>, f: (a: A) => B): AsyncGenerator<B, R> {
    let next = await g.next();
    while (!next.done) {
        yield f(next.value);
        next = await g.next();
    }
    return next.value;
}

type Input = (mode: "peek" | "eat") => Promise<{ char: string; yield: boolean; eof: boolean }>;

/**
 * Returns a function which when called repeatedly returns succesive characters from {@link raw}. Its return values' fields are:
 * - char: The current character. Is the empty string when `eof` is true.
 * - yield: Is `true` iff this is the last character in a chunk produced by {@link raw}.
 * - eof: Is `true` when {@link raw} is out of characters.
 */
export function input(raw: AsyncIterable<string>): Input {
    const iterator = raw[Symbol.asyncIterator]();
    let chunk = "";
    let index = 0;

    return async (mode) => {
        while (index >= chunk.length) {
            const next = await iterator.next();
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

async function* skipWs<T>(inp: Input, toYield: () => T) {
    while (true) {
        const r = await inp("peek");
        if (![" ", "\t", "\n", "\r"].includes(r.char)) break;
        inp("eat");
        if (r.yield) yield toYield();
    }
}

async function* parse(inp: Input): AsyncGenerator<unknown, unknown> {
    const r = await inp("peek");
    switch (r.char) {
        case "n": return yield* parseLiteral(inp, "null", null);
        case "t": return yield* parseLiteral(inp, "true", true);
        case "f": return yield* parseLiteral(inp, "false", false);
        case "[": return yield* parseArray(inp);
        case '"': return yield* parseString(inp);
        case '{': return yield* parseObject(inp);
        default:
            if ("0" <= r.char && r.char <= "9" || r.char == "-") return yield* parseNumber(inp);
    }
    throw new JsonParsingError();
}

async function* parseLiteral<T>(inp: Input, literal: string, value: T) {
    for (let i = 0; i < literal.length; i++) {
        const r = await inp("eat");
        if (r.char !== literal[i]) throw new JsonParsingError();
        if (r.yield) yield value;
    }
    return value;
}

async function* parseArray(inp: Input) {
    let r = await inp("eat");
    if (r.char !== "[") throw new JsonParsingError();
    if (r.yield) yield [];

    let result: unknown[] = [];
    yield* skipWs(inp, () => []);
    r = await inp("peek");
    if (r.char === "]") {
        await inp("eat");
        if (r.yield) yield [];
        return result;
    }

    while (true) {
        const element = yield* gmap(parse(inp), el => [...result, el]);
        result = [...result, element];
        yield* skipWs(inp, () => result);

        const r = await inp("peek");
        if (r.char === "]") {
            await inp("eat");
            if (r.yield) yield result;
            return result;
        }
        if (r.char !== ",") throw new JsonParsingError();
        if ((await inp("eat")).yield) yield result;
        yield* skipWs(inp, () => result);
    }
}

function hexDigit(c: string) {
    if ("0" <= c && c <= "9") return c.charCodeAt(0) - 48;
    if ("a" <= c && c <= "f") return c.charCodeAt(0) - 87;
    if ("A" <= c && c <= "F") return c.charCodeAt(0) - 55;
    throw new JsonParsingError();
}

async function* parseHex4(inp: Input) {
    let result = 0;
    for (let i = 0; i < 4; i++) {
        const r = await inp("eat");
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
async function* parseEscape(inp: Input): AsyncGenerator<void, string> {
    let r = await inp("eat");
    if (r.char in basicEscapes) {
        if (r.yield) yield;
        return basicEscapes[r.char]!;
    }
    if (r.char !== "u") throw new JsonParsingError();

    // WTF-16 is stupid
    const hex = yield* parseHex4(inp);
    if (!(0xD800 <= hex && hex < 0xDC00)) return String.fromCharCode(hex);
    // High surrogate — check for low surrogate pair
    r = await inp("peek");
    if (r.yield) yield;
    if (r.char !== "\\") return String.fromCharCode(hex);
    await inp("eat"); // '\'
    r = await inp("peek");
    if (r.yield) yield;
    if (r.char !== "u") {
        // Consumed '\' but next isn't 'u' — emit high surrogate, then handle escape
        const next = yield* parseEscape(inp);
        return String.fromCharCode(hex) + next;
    }
    await inp("eat"); // 'u'
    const low = yield* parseHex4(inp);
    if (0xDC00 <= low && low < 0xE000)
        return String.fromCodePoint(0x10000 + ((hex - 0xD800) << 10) + (low - 0xDC00));
    // Not a valid low surrogate — emit both
    return String.fromCharCode(hex) + String.fromCharCode(low);
}

async function* parseString(inp: Input) {
    let r = await inp("eat");
    if (r.char !== '"') throw new JsonParsingError();
    if (r.yield) yield "";

    let result = "";
    while (true) {
        r = await inp("eat");
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

async function* parseObject(inp: Input) {
    let r = await inp("eat");
    if (r.char !== "{") throw new JsonParsingError();
    if (r.yield) yield {};

    let object: Record<string, unknown> = {};
    yield* skipWs(inp, () => object);
    r = await inp("peek");
    if (r.char === "}") {
        await inp("eat");
        if (r.yield) yield object;
        return object;
    }

    while (true) {
        const key = yield* gmap(parseString(inp), _ => object);
        yield* skipWs(inp, () => object);

        if ((await inp("eat")).char !== ":") throw new JsonParsingError();
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

        const r = await inp("peek");
        if (r.char === "}") {
            await inp("eat");
            if (r.yield) yield object;
            return object;
        }
        if (r.char !== ",") throw new JsonParsingError();
        if ((await inp("eat")).yield) yield object;
        yield* skipWs(inp, () => object);
    }
}

async function* parseNumber(inp: Input) {
    let numStr = "";

    if ((await inp("peek")).char === "-") {
        numStr += "-";
        if ((await inp("eat")).yield) yield 0;
    }

    let foundDigit = false;
    while (true) {
        const r = await inp("peek");
        if (r.char < "0" || r.char > "9") break;
        numStr += r.char;
        if (r.yield) yield Number(numStr);
        await inp("eat");
        foundDigit = true;
    }
    if (!foundDigit) throw new JsonParsingError();

    // Disallow leading zeros for non-zero numbers
    const intStart = numStr[0] === "-" ? 1 : 0;
    if (numStr.length - intStart > 1 && numStr[intStart] === "0") throw new JsonParsingError();

    let r = await inp("peek");
    if (r.char === ".") {
        if (r.yield) yield Number(numStr);
        numStr += ".";
        await inp("eat");

        let foundDigit = false;
        while (true) {
            const r = await inp("peek");
            if (r.char < "0" || r.char > "9") break;
            numStr += r.char;
            if (r.yield) yield Number(numStr);
            await inp("eat");
            foundDigit = true;
        }
        if (!foundDigit) throw new JsonParsingError();
    }

    r = await inp("peek");
    if (["e", "E"].includes(r.char)) {
        if (r.yield) yield Number(numStr);
        const numWithoutExp = numStr;
        numStr += r.char;
        await inp("eat");

        r = await inp("peek");
        if (["-", "+"].includes(r.char)) {
            if (r.yield) yield Number(numWithoutExp);
            numStr += r.char;
            await inp("eat");
        }

        let foundDigit = false;
        while (true) {
            r = await inp("peek");
            if (r.char < "0" || r.char > "9") break;
            numStr += r.char;
            if (r.yield) yield Number(numStr);
            await inp("eat");
            foundDigit = true;
        }
        if (!foundDigit) throw new JsonParsingError();
    }

    return Number(numStr);
}
