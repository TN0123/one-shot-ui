declare module "pngjs" {
  export class PNG {
    constructor(options?: { width?: number; height?: number });
    width: number;
    height: number;
    data: Uint8Array;
    static sync: {
      write(png: PNG): Uint8Array;
    };
  }
}
