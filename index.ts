/**
 * Error thrown when the streamed input is not valid JSON, is incomplete when
 * marked complete, or when a closed parser is used again.
 */
export class JsonParsingError extends Error {}

const NEED_MORE = Symbol("need more");
type NeedMore = typeof NEED_MORE;

type Char = { char: string; eof: boolean; chunkEnd: boolean };

/**
 * Incremental JSON parser that accepts chunks of a single JSON document and
 * exposes the best partial value available after each chunk.
 */
export type JsonParser = {
    /**
     * Returns the latest partial or complete parsed value without consuming input.
     *
     * Returns `undefined` until enough input has arrived to produce a value.
     */
    value(): unknown;

    /**
     * Appends a chunk of JSON text and returns the latest partial or complete value.
     *
     * @throws {JsonParsingError} If the accumulated input is invalid JSON or the
     * parser has already been closed.
     */
    feed(chunk: string): unknown;

    /**
     * Marks the input as complete and returns the complete parsed value.
     *
     * @throws {JsonParsingError} If the document is incomplete, invalid, or the
     * parser has already been closed.
     */
    end(): unknown;
};

/**
 * Creates a parser for one streamed JSON document.
 *
 * Feed chunks with {@link JsonParser.feed}; optionally call {@link JsonParser.end}
 * when no more chunks will arrive to validate and retrieve the complete value.
 */
export function makeParser(): JsonParser {
    const input = new Input();
    const parser = parseDocument(input);
    let value: unknown;
    let closed = false;
    let poisonedError: unknown;

    function fail(e: unknown): never {
        poisonedError = e;
        closed = true;
        throw e;
    }

    function run() {
        try {
            while (true) {
                const next = parser.next();
                if (next.done) {
                    value = next.value;
                    return true;
                }
                if (next.value === NEED_MORE) return false;
                value = next.value;
            }
        } catch (e) {
            fail(e);
        }
    }

    function checkOpen() {
        if (poisonedError !== undefined) throw poisonedError;
        if (closed) throw new JsonParsingError();
    }

    return {
        value: () => value,
        feed(chunk: string) {
            checkOpen();
            input.buffer += chunk;
            run();
            return value;
        },
        end() {
            checkOpen();
            input.ended = true;
            if (!run()) fail(new JsonParsingError());
            closed = true;
            return value;
        },
    };
}

class Input {
    buffer = "";
    index = 0;
    ended = false;

    *peek(): Generator<NeedMore, Char> {
        while (this.index >= this.buffer.length) {
            if (this.ended) return { char: "", eof: true, chunkEnd: true };
            yield NEED_MORE;
        }
        return {
            char: this.buffer[this.index]!,
            eof: false,
            chunkEnd: this.index == this.buffer.length - 1,
        };
    }

    *eat(): Generator<NeedMore, Char> {
        const r = yield* this.peek();
        if (!r.eof && ++this.index > 4096) {
            this.buffer = this.buffer.slice(this.index);
            this.index = 0;
        }
        return r;
    }
}

function* gmap<A, B, R>(
    g: Generator<A | NeedMore, R>,
    f: (value: A) => B,
): Generator<B | NeedMore, R> {
    while (true) {
        const next = g.next();
        if (next.done) return next.value;
        if (next.value === NEED_MORE) yield NEED_MORE;
        else yield f(next.value);
    }
}

function* skipWs<T>(inp: Input, toYield: () => T) {
    while (true) {
        const r = yield* inp.peek();
        if (![" ", "\t", "\n", "\r"].includes(r.char)) break;
        yield* inp.eat();
        if (r.chunkEnd) yield toYield();
    }
}

function* parseDocument(inp: Input) {
    yield* skipWs(inp, () => undefined);
    const first = yield* inp.peek();
    if (first.eof) throw new JsonParsingError();
    const value = yield* parse(inp);
    yield* skipWs(inp, () => value);
    const r = yield* inp.peek();
    if (!r.eof) throw new JsonParsingError();
    return value;
}

function* parse(inp: Input): Generator<unknown> {
    const r = yield* inp.peek();
    if (r.eof) throw new JsonParsingError();
    switch (r.char) {
        case "n": return yield* parseLiteral(inp, "null", null);
        case "t": return yield* parseLiteral(inp, "true", true);
        case "f": return yield* parseLiteral(inp, "false", false);
        case "[": return yield* parseArray(inp);
        case '"': return yield* parseString(inp);
        case "{": return yield* parseObject(inp);
        default:
            if ("0" <= r.char && r.char <= "9" || r.char == "-")
                return yield* parseNumber(inp);
    }
    throw new JsonParsingError();
}

function* parseLiteral<T>(inp: Input, literal: string, value: T) {
    for (let i = 0; i < literal.length; i++) {
        const r = yield* inp.eat();
        if (r.char !== literal[i]) throw new JsonParsingError();
        if (r.chunkEnd) yield value;
    }
    return value;
}

function* parseArray(inp: Input) {
    let r = yield* inp.eat();
    if (r.char !== "[") throw new JsonParsingError();
    if (r.chunkEnd) yield [];

    let result: unknown[] = [];
    yield* skipWs(inp, () => []);
    r = yield* inp.peek();
    if (r.char === "]") {
        yield* inp.eat();
        if (r.chunkEnd) yield result;
        return result;
    }

    while (true) {
        const element = yield* gmap(parse(inp), (el) => [...result, el]);
        result = [...result, element];
        yield* skipWs(inp, () => result);

        r = yield* inp.peek();
        if (r.char === "]") {
            yield* inp.eat();
            if (r.chunkEnd) yield result;
            return result;
        }
        if (r.char !== ",") throw new JsonParsingError();
        yield* inp.eat();
        if (r.chunkEnd) yield result;
        yield* skipWs(inp, () => result);
    }
}

function hexDigit(c: string) {
    if ("0" <= c && c <= "9") return c.charCodeAt(0) - 48;
    if ("a" <= c && c <= "f") return c.charCodeAt(0) - 87;
    if ("A" <= c && c <= "F") return c.charCodeAt(0) - 55;
    throw new JsonParsingError();
}

function* parseHex4(inp: Input) {
    let result = 0;
    for (let i = 0; i < 4; i++) {
        const r = yield* inp.eat();
        if (r.chunkEnd) yield;
        result = (result << 4) | hexDigit(r.char);
    }
    return result;
}

const basicEscapes: Record<string, string> = {
    '"': '"',
    "\\": "\\",
    "/": "/",
    b: "\b",
    f: "\f",
    n: "\n",
    r: "\r",
    t: "\t",
};

/**
 * Expects the initial `\` to have been eaten already
 */
function* parseEscape(inp: Input): Generator<string | NeedMore | undefined> {
    let r = yield* inp.eat();
    if (r.char in basicEscapes) {
        if (r.chunkEnd) yield;
        return basicEscapes[r.char]!;
    }
    if (r.char !== "u") throw new JsonParsingError();

    const hex = yield* parseHex4(inp);
    if (!(0xd800 <= hex && hex < 0xdc00)) return String.fromCharCode(hex);

    r = yield* inp.peek();
    if (r.chunkEnd) yield;
    if (r.char !== "\\") return String.fromCharCode(hex);
    yield* inp.eat();
    r = yield* inp.peek();
    if (r.chunkEnd) yield;
    if (r.char !== "u") {
        const next = yield* parseEscape(inp);
        return String.fromCharCode(hex) + next;
    }
    yield* inp.eat();
    const low = yield* parseHex4(inp);
    if (0xdc00 <= low && low < 0xe000)
        return String.fromCodePoint(
            0x10000 + ((hex - 0xd800) << 10) + (low - 0xdc00),
        );
    return String.fromCharCode(hex) + String.fromCharCode(low);
}

function* parseString(inp: Input) {
    let r = yield* inp.eat();
    if (r.char !== '"') throw new JsonParsingError();
    if (r.chunkEnd) yield "";

    let result = "";
    while (true) {
        r = yield* inp.eat();
        if (r.char === '"') {
            if (r.chunkEnd) yield result;
            return result;
        } else if (r.char === "\\") {
            if (r.chunkEnd) yield result;
            const esc = yield* gmap(parseEscape(inp), () => result);
            result += esc;
        } else if (r.char.charCodeAt(0) < 0x20) {
            // Must be escaped to be valid in a string literal.
            throw new JsonParsingError();
        } else if (r.eof) {
            throw new JsonParsingError();
        } else {
            result += r.char;
            if (r.chunkEnd) yield result;
        }
    }
}

function* parseObject(inp: Input) {
    let r = yield* inp.eat();
    if (r.char !== "{") throw new JsonParsingError();
    if (r.chunkEnd) yield {};

    let object: Record<string, unknown> = {};
    yield* skipWs(inp, () => object);
    r = yield* inp.peek();
    if (r.char === "}") {
        yield* inp.eat();
        if (r.chunkEnd) yield object;
        return object;
    }

    while (true) {
        const key = yield* gmap(parseString(inp), () => object);
        yield* skipWs(inp, () => object);

        r = yield* inp.eat();
        if (r.char !== ":") throw new JsonParsingError();
        if (r.chunkEnd) yield object;
        yield* skipWs(inp, () => object);

        const value = yield* gmap(parse(inp), (value) =>
            Object.defineProperty({ ...object }, key, {
                value,
                writable: true,
                enumerable: true,
                configurable: true,
            }),
        );
        yield* skipWs(inp, () => object);

        object = Object.defineProperty({ ...object }, key, {
            value,
            writable: true,
            enumerable: true,
            configurable: true,
        });

        r = yield* inp.peek();
        if (r.char === "}") {
            yield* inp.eat();
            if (r.chunkEnd) yield object;
            return object;
        }
        if (r.char !== ",") throw new JsonParsingError();
        yield* inp.eat();
        if (r.chunkEnd) yield object;
        yield* skipWs(inp, () => object);
    }
}

function* parseNumber(inp: Input) {
    let numStr = "";

    let r = yield* inp.peek();
    if (r.char === "-") {
        numStr += "-";
        yield* inp.eat();
        if (r.chunkEnd) yield 0;
    }

    let foundDigit = false;
    while (true) {
        r = yield* inp.peek();
        if (r.char < "0" || r.char > "9") break;
        numStr += r.char;
        if (r.chunkEnd) yield Number(numStr);
        yield* inp.eat();
        foundDigit = true;
    }
    if (!foundDigit) throw new JsonParsingError();

    // Disallow leading zeros for non-zero numbers
    const intStart = numStr[0] === "-" ? 1 : 0;
    if (numStr.length - intStart > 1 && numStr[intStart] === "0")
        throw new JsonParsingError();

    r = yield* inp.peek();
    if (r.char === ".") {
        if (r.chunkEnd) yield Number(numStr);
        numStr += ".";
        yield* inp.eat();

        let foundDigit = false;
        while (true) {
            r = yield* inp.peek();
            if (r.char < "0" || r.char > "9") break;
            numStr += r.char;
            if (r.chunkEnd) yield Number(numStr);
            yield* inp.eat();
            foundDigit = true;
        }
        if (!foundDigit) throw new JsonParsingError();
    }

    r = yield* inp.peek();
    if (["e", "E"].includes(r.char)) {
        if (r.chunkEnd) yield Number(numStr);
        const numWithoutExp = numStr;
        numStr += r.char;
        yield* inp.eat();

        r = yield* inp.peek();
        if (["-", "+"].includes(r.char)) {
            if (r.chunkEnd) yield Number(numWithoutExp);
            numStr += r.char;
            yield* inp.eat();
        }

        let foundDigit = false;
        while (true) {
            r = yield* inp.peek();
            if (r.char < "0" || r.char > "9") break;
            numStr += r.char;
            if (r.chunkEnd) yield Number(numStr);
            yield* inp.eat();
            foundDigit = true;
        }
        if (!foundDigit) throw new JsonParsingError();
    }

    return Number(numStr);
}
