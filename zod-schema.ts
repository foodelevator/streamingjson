import * as z from "zod";

export type ZStreaming<T extends z.ZodType> =
    T extends z.ZodObject<infer Shape extends z.ZodRawShape> ?
        z.ZodObject<{
            [K in keyof Shape]: z.ZodOptional<ZStreaming<Shape[K] & z.ZodType>>;
        }>
    : T extends z.ZodArray<infer Element> ?
        z.ZodArray<ZStreaming<Element & z.ZodType>>
    : T extends z.ZodEnum<infer Values> ?
        z.ZodUnion<[z.ZodEnum<Values>, z.ZodString]>
    : T extends z.ZodLiteral<infer Value> ?
        Value extends string ?
            z.ZodUnion<[T, z.ZodString]>
        : Value extends number ?
            z.ZodNumber
        : T
    : T extends z.ZodOptional<infer Inner> ?
        z.ZodOptional<ZStreaming<Inner & z.ZodType>>
    : T extends z.ZodNullable<infer Inner> ?
        z.ZodNullable<ZStreaming<Inner & z.ZodType>>
    : T extends z.ZodUnion<infer Options> ?
        z.ZodUnion<{
            [K in keyof Options]: ZStreaming<Options[K] & z.ZodType>;
        } & [z.ZodType, z.ZodType, ...z.ZodType[]]>
    : T; // string, number, boolean, null, etc. pass through unchanged

export function zStreaming<T extends z.ZodType>(schema: T): ZStreaming<T> {
    if (schema instanceof z.ZodObject) {
        const shape = schema.shape as Record<string, z.ZodType>;
        const newShape: Record<string, z.ZodType> = {};
        for (const key in shape) {
            newShape[key] = zStreaming(shape[key]!).optional();
        }
        return z.object(newShape) as any;
    } else if (schema instanceof z.ZodArray) {
        return z.array(zStreaming((schema as any).element)) as any;
    } else if (schema instanceof z.ZodEnum) {
        return z.union([schema, z.string()]) as any;
    } else if (schema instanceof z.ZodLiteral) {
        const value = schema.value;
        if (typeof value === "string") return z.union([schema, z.string()]) as any;
        if (typeof value === "number") return z.number() as any;
        return schema as any;
    } else if (schema instanceof z.ZodOptional) {
        return zStreaming((schema as any).unwrap()).optional() as any;
    } else if (schema instanceof z.ZodNullable) {
        return zStreaming((schema as any).unwrap()).nullable() as any;
    } else if (schema instanceof z.ZodUnion) {
        const options = (schema as any).options
            .map((o: z.ZodType) => zStreaming(o));
        return z.union(options as [z.ZodType, z.ZodType, ...z.ZodType[]]) as any;
    } else {
        return schema as any;
    }
}
