// Minimal typings for the parts of `utif` (no @types package) that tiff.tsx uses.
declare module "utif" {
  /** One image file directory. Tags are keyed "t<tag>" (t256 = width, t257 = height). */
  export interface IFD {
    [tag: string]: unknown;
    width: number;
    height: number;
    data: Uint8Array;
  }
  export function decode(buffer: ArrayBuffer | Uint8Array): IFD[];
  export function decodeImage(buffer: ArrayBuffer | Uint8Array, ifd: IFD, ifds?: IFD[]): void;
  export function toRGBA8(ifd: IFD): Uint8Array;
}
