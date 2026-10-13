/** Display adaptation, separate from radiometric measurements. These time constants
 * approximate brightness adaptation; this is not a rod/cone visibility model. */
export class VisualAdaptation {
  private target: number | null = null;
  private adapted: number | null = null;

  measure(luminances: number[]) {
    // Exclude empty space; trim solar glints and the darkest tail. A small bright
    // aperture must not set exposure for the whole inhabited landscape.
    const lit = luminances.filter(value => value > 0).sort((a,b) => a-b);
    if (!lit.length) return;
    const start = Math.floor(lit.length * 0.1), end = Math.ceil(lit.length * 0.9);
    let sum = 0;
    for (let i=start;i<end;i++) sum += Math.log(Math.max(0.0001,lit[i]));
    this.target = Math.exp(sum/(end-start));
    this.adapted ??= this.target;
  }

  update(seconds: number) {
    if (this.target === null || this.adapted === null) return;
    const tau = this.target > this.adapted ? 0.6 : 3;
    this.adapted = Math.exp(Math.log(this.adapted) +
      (Math.log(this.target)-Math.log(this.adapted))*(-Math.expm1(-seconds/tau)));
  }

  get luminance() { return this.adapted ?? 1000; }
  exposure(referenceIlluminance: number) {
    // The floor limits amplification in darkness. Zero radiance stays zero.
    // 0.13 at the filmic curve input maps to approximately 18% display luminance.
    return 0.13*referenceIlluminance/(this.luminance+0.01);
  }
}
