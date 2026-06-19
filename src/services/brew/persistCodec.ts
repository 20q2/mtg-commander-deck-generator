/**
 * JSON codec for brew-session persistence.
 *
 * Plain `JSON.stringify` turns a `Set`/`Map` into `{}` — losing the data and crashing any reader
 * that later calls `.has`/`.get` on the resumed value. This codec serializes any `Set`/`Map` (at
 * any depth in the context/state) as a tagged array and rehydrates it on the way back, so adding a
 * new `Set`/`Map` field to `BrewContext`/`BrewState` "just works" across a sessionStorage resume.
 */
export function serializeBrew(value: unknown): string {
  return JSON.stringify(value, (_key, v) => {
    if (v instanceof Set) return { __brewSet: [...v] };
    if (v instanceof Map) return { __brewMap: [...v] };
    return v;
  });
}

export function deserializeBrew<T>(raw: string): T {
  return JSON.parse(raw, (_key, v) => {
    if (v && typeof v === 'object') {
      const set = (v as { __brewSet?: unknown[] }).__brewSet;
      if (Array.isArray(set)) return new Set(set);
      const map = (v as { __brewMap?: [unknown, unknown][] }).__brewMap;
      if (Array.isArray(map)) return new Map(map);
    }
    return v;
  }) as T;
}
