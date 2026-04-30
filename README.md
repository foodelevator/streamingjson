# streamingjson

Streaming JSON parser that produces partial values as chunks arrive.

- `makeParser` initializes a `JsonParser` instance.
- `JsonParser.feed` appends a JSON chunk to the parser & returns the current partial value.
- `JsonParser.value` returns a reference to the current value.
- `JsonParser.end` marks the input as complete, making sure that it is at the end of a JSON value.
- `zStreaming` wraps a Zod schema so it accepts partial values.

## Example Usage

```ts
import { makeParser } from "@foodelevator/streamingjson";

const parser = makeParser();

function onDelta(delta: string) {
    console.log(parser.feed(delta));
    // {}
    // { name: "Ali" }
    // { name: "Alice" }
    // { name: "Alice", age: 3 }
    // { name: "Alice", age: 34 }
    // { name: "Alice", age: 34, tags: ["ty"] }
    // { name: "Alice", age: 34, tags: ["typescript", "z"] }
    // ...

}

// Optionally call when no more chunks will arrive. Throws if the document is incomplete or invalid.
const finalValue = parser.end();
```

```ts
import { zStreaming } from "@foodelevator/streamingjson";
import * as z from "zod";

const someSchema = z.object({
  a: z.number(),
  b: z.enum(["hello", "there"]),
  tags: z.array(z.string()),
});
const streamingSchema = zStreaming(someSchema);
type StreamingThing = z.infer<typeof streamingSchema>;
// type StreamingThing = {
//     a?: number | undefined;
//     b?: string | undefined;
//     tags?: string[] | undefined;
// }
```
