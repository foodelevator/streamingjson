export class JsonParsingError extends Error {
}

export function parseJson(s: string | Iterable<string>): unknown {
    let inp;
    if (typeof s === "string") {
        inp = input([s]);
    } else if (Symbol.iterator in s) {
        inp = input(s);
    } else {
        throw new TypeError();
    }
    skipWs(inp);
    const value = parse(inp);
    skipWs(inp);
    if (!inp("peek").eof) throw new JsonParsingError();
    return value;
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

function skipWs(inp: Input): void {
    while ([" ", "\t", "\n", "\r"].includes(inp("peek").char))
        inp("eat");
}

function parse(inp: Input): unknown {
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

function parseLiteral(inp: Input, literal: string, value: unknown): unknown {
    for (let i = 0; i < literal.length; i++) {
        const r = inp("eat");
        if (r.char !== literal[i]) throw new JsonParsingError();
    }
    return value;
}

function parseArray(inp: Input): unknown[] {
    if (inp("eat").char !== "[") throw new JsonParsingError();

    const result: unknown[] = [];
    skipWs(inp);
    if (inp("peek").char === "]") { inp("eat"); return result; }

    while (true) {
        const value = parse(inp);
        result.push(value);
        skipWs(inp);

        const r = inp("peek");
        if (r.char === "]") { inp("eat"); return result; }
        if (r.char !== ",") throw new JsonParsingError();
        inp("eat");
        skipWs(inp);
    }
}

function hexDigit(c: string): number {
    if ("0" <= c && c <= "9") return c.charCodeAt(0) - 48;
    if ("a" <= c && c <= "f") return c.charCodeAt(0) - 87;
    if ("A" <= c && c <= "F") return c.charCodeAt(0) - 55;
    throw new JsonParsingError();
}

function parseHex4(inp: Input): number {
    let result = 0;
    for (let i = 0; i < 4; i++) {
        result = (result << 4) | hexDigit(inp("eat").char);
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
function parseEscape(inp: Input): string {
    const r = inp("eat");
    if (r.char in basicEscapes) {
        return basicEscapes[r.char]!;
    }
    if (r.char !== "u") throw new JsonParsingError();

    // WTF-16 is stupid
    const hex = parseHex4(inp);
    if (!(0xD800 <= hex && hex < 0xDC00)) return String.fromCharCode(hex);
    // High surrogate — check for low surrogate pair
    if (inp("peek").char !== "\\") return String.fromCharCode(hex);
    inp("eat"); // '\'
    if (inp("peek").char !== "u") {
        // Consumed '\' but next isn't 'u' — emit high surrogate, then handle escape
        return String.fromCharCode(hex) + parseEscape(inp);
    }
    inp("eat"); // 'u'
    const low = parseHex4(inp);
    if (0xDC00 <= low && low < 0xE000)
        return String.fromCodePoint(0x10000 + ((hex - 0xD800) << 10) + (low - 0xDC00));
    // Not a valid low surrogate — emit both
    return String.fromCharCode(hex) + String.fromCharCode(low);
}

function parseString(inp: Input): string {
    if (inp("eat").char !== '"') throw new JsonParsingError();

    let result = "";
    while (true) {
        const r = inp("eat");
        if (r.char === '"') return result;
        if (r.char === "\\") {
            result += parseEscape(inp);
        } else if (r.char.charCodeAt(0) < 0x20) {
            // Must be escaped to be valid in a string literal.
            throw new JsonParsingError();
        } else if (r.eof) {
            throw new JsonParsingError();
        } else {
            result += r.char;
        }
    }
}

function parseObject(inp: Input): Record<string, unknown> {
    if (inp("eat").char !== "{") throw new JsonParsingError();

    const object: Record<string, unknown> = {};
    skipWs(inp);
    if (inp("peek").char === "}") { inp("eat"); return object; }

    while (true) {
        const key = parseString(inp);
        skipWs(inp);

        if (inp("eat").char !== ":") throw new JsonParsingError();
        skipWs(inp);

        const value = parse(inp);
        skipWs(inp);

        Object.defineProperty(object, key, { value, writable: true, enumerable: true, configurable: true });

        const r = inp("peek");
        if (r.char === "}") { inp("eat"); return object; }
        if (r.char !== ",") throw new JsonParsingError();
        inp("eat");
        skipWs(inp);
    }
}

function parseNumber(inp: Input): number {
    let numStr = "";

    if (inp("peek").char === "-") {
        numStr += "-";
        inp("eat");
    }

    let foundDigit = false;
    while (true) {
        const r = inp("peek");
        if (r.char < "0" || r.char > "9") break;
        numStr += r.char;
        inp("eat");
        foundDigit = true;
    }
    if (!foundDigit) throw new JsonParsingError();

    // Disallow leading zeros for non-zero numbers
    const intStart = numStr[0] === "-" ? 1 : 0;
    if (numStr.length - intStart > 1 && numStr[intStart] === "0") throw new JsonParsingError();

    if (inp("peek").char === ".") {
        numStr += ".";
        inp("eat");

        let foundDigit = false;
        while (true) {
            const r = inp("peek");
            if (r.char < "0" || r.char > "9") break;
            numStr += r.char;
            inp("eat");
            foundDigit = true;
        }
        if (!foundDigit) throw new JsonParsingError();
    }

    let r = inp("peek");
    if (["e", "E"].includes(r.char)) {
        numStr += r.char;
        inp("eat");

        r = inp("peek");
        if (["-", "+"].includes(r.char)) {
            numStr += r.char;
            inp("eat");
        }

        let foundDigit = false;
        while (true) {
            r = inp("peek");
            if (r.char < "0" || r.char > "9") break;
            numStr += r.char;
            inp("eat");
            foundDigit = true;
        }
        if (!foundDigit) throw new JsonParsingError();
    }

    return Number(numStr);
}
