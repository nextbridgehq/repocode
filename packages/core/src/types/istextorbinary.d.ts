// Type declaration for istextorbinary — bundler moduleResolution skips its "node"-only
// exports conditions, so we declare the subset of the API we use directly.
declare module 'istextorbinary' {
  export function isText(filename?: string | null, buffer?: Buffer | null): boolean | null;
  export function isBinary(filename?: string | null, buffer?: Buffer | null): boolean | null;
}
